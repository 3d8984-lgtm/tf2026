// Per-PNG upload + finalize pipeline.
//
// Browser fans out N parallel PUTs to /orders/:jobId/parts?name=...&token=...
// (one per PNG). The worker writes each body to a session tmp dir. When all
// uploads complete, the browser POSTs /orders/:jobId/finalize?token=... and the
// worker builds the ZIP on disk, uploads it to Storage via the signed URL, and
// sends the bundle to WeChat — same downstream behaviour as the old
// upload-stream route, just without one giant streaming PUT from the browser.

import type { Request, Response } from "express";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fetchJob, type JobInfo } from "./api.js";
import { callback } from "./callback.js";
import { sendBundleToWeChat } from "./wechat.js";

const MAX_PART_BYTES = 256 * 1024 * 1024; // 256 MiB per PNG (generous)
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

// Token cache to avoid hammering worker-fetch-job on every part PUT.
const jobCache = new Map<string, { info: JobInfo; expiresAt: number }>();
const JOB_CACHE_TTL_MS = 10 * 60 * 1000;

async function loadJobCached(jobId: string): Promise<JobInfo> {
  const hit = jobCache.get(jobId);
  if (hit && hit.expiresAt > Date.now()) return hit.info;
  const info = await fetchJob(jobId);
  jobCache.set(jobId, { info, expiresAt: Date.now() + JOB_CACHE_TTL_MS });
  return info;
}

function sessionDir(jobId: string): string {
  return join(tmpdir(), `order-${jobId}-parts`);
}

function safeName(raw: string): string | null {
  if (!raw) return null;
  // Strip any path components, keep only basename.
  const base = raw.replace(/[\\/]+/g, "/").split("/").pop() || "";
  // Disallow control chars, leading dot, empty.
  if (!base || base.startsWith(".") || /[\u0000-\u001f]/.test(base)) return null;
  if (base.length > 200) return null;
  return base;
}

async function receivePartToFile(req: Request, target: string): Promise<number> {
  let total = 0;
  const counter = new Transform({
    transform(chunk: string | Buffer, _enc, done) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_PART_BYTES) {
        done(new Error(`part too large (>${MAX_PART_BYTES} bytes)`));
        return;
      }
      done(null, buf);
    },
  });
  await pipeline(req, counter, createWriteStream(target));
  return total;
}

export async function uploadPart(req: Request, res: Response): Promise<void> {
  req.setTimeout(STREAM_TIMEOUT_MS);
  res.setTimeout(STREAM_TIMEOUT_MS);

  const jobId = String(req.params.jobId || "");
  const token = String(req.query.token || "");
  const rawName = String(req.query.name || "");
  if (!jobId || !token || !rawName) {
    res.status(400).json({ error: "jobId, token, name required" });
    return;
  }
  const name = safeName(rawName);
  if (!name) {
    res.status(400).json({ error: "invalid name" });
    return;
  }

  let info: JobInfo;
  try {
    info = await loadJobCached(jobId);
  } catch (e) {
    res.status(502).json({ error: `fetch job: ${(e as Error).message}` });
    return;
  }
  if (!info?.job || (info.job as any).upload_token !== token) {
    res.status(401).json({ error: "invalid upload token" });
    return;
  }

  const dir = sessionDir(jobId);
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);

  try {
    const bytes = await receivePartToFile(req, target);
    res.status(200).json({ ok: true, name, bytes });
  } catch (e) {
    await rm(target, { force: true }).catch(() => undefined);
    res.status(400).json({ error: (e as Error).message });
  }
}

// (Legacy ZIP-build / Storage-upload helpers removed — finalize now hands
// off the download URL to WeChat and streams the ZIP on demand via
// downloadZip.ts.)

export async function finalizeUpload(req: Request, res: Response): Promise<void> {
  req.setTimeout(STREAM_TIMEOUT_MS);
  res.setTimeout(STREAM_TIMEOUT_MS);

  const jobId = String(req.params.jobId || "");
  const token = String(req.query.token || "");
  if (!jobId || !token) {
    res.status(400).json({ error: "jobId, token required" });
    return;
  }

  let info: JobInfo;
  try {
    info = await loadJobCached(jobId);
  } catch (e) {
    res.status(502).json({ error: `fetch job: ${(e as Error).message}` });
    return;
  }
  if (!info?.job || (info.job as any).upload_token !== token) {
    res.status(401).json({ error: "invalid upload token" });
    return;
  }

  const dir = sessionDir(jobId);
  let parts: string[] = [];
  try {
    parts = (await readdir(dir)).filter((n) => !n.startsWith("."));
  } catch {
    res.status(400).json({ error: "no parts uploaded" });
    return;
  }
  if (parts.length === 0) {
    res.status(400).json({ error: "no parts uploaded" });
    return;
  }

  // Compute public download URL for the streaming ZIP endpoint. Prefer the
  // explicit WORKER_PUBLIC_URL env (set on Render), fall back to the inbound
  // request host. Render terminates TLS, so https is safe.
  const publicBase = (process.env.WORKER_PUBLIC_URL || `https://${req.get("host") || ""}`).replace(/\/$/, "");
  const downloadUrl = `${publicBase}/orders/${jobId}/download-zip?token=${encodeURIComponent(token)}`;

  // Respond immediately. The streaming-download model means there's no more
  // "ZIP 생성 / Storage 업로드" work to do here — we just notify WeChat.
  res.status(202).json({ ok: true, jobId, parts: parts.length, downloadUrl, accepted: true });

  (async () => {
    try {
      // Estimate total bytes (informational only).
      let totalPartBytes = 0;
      for (const p of parts) {
        try {
          const s = await stat(join(dir, p));
          totalPartBytes += s.size;
        } catch { /* ignore */ }
      }

      await callback({
        jobId,
        status: "wechat",
        stage: "위챗 전송 중",
        progress_current: parts.length,
        progress_total: parts.length,
        bundle_zip_url: downloadUrl,
        bundle_size: totalPartBytes,
        error_message: null,
      });

      try {
        const sizeMb = (totalPartBytes / 1024 / 1024).toFixed(1);
        const summary =
          `【발주 ZIP 다운로드 준비 완료】\n` +
          `작업번호: ${info.job.order_no}\n` +
          `수량: ${parts.length}건 (총 ${sizeMb}MB)\n` +
          `다운로드: ${downloadUrl}\n` +
          `※ 링크 클릭 시 즉시 ZIP 스트리밍 다운로드가 시작됩니다.`;
        await sendBundleToWeChat({
          jobId,
          webhookUrl: info.job.webhook_url,
          orderNo: info.job.order_no,
          // Force the text-link branch: oversized + no key path so it always
          // sends the worker download URL.
          zipSize: Math.max(totalPartBytes, 50 * 1024 * 1024),
          zipFilename: `${info.job.order_no}-bundle.zip`,
          zipUrl: downloadUrl,
          itemCount: parts.length,
          // Override summary by passing a custom text via WeChat text msg.
          // sendBundleToWeChat falls back to its own text when oversized, so
          // we send our richer summary separately.
        });
        // Send the explicit Korean summary in addition to the function's auto text.
        try {
          const { sendToWeChat } = await import("./wechat.js");
          await sendToWeChat("dev", summary).catch(() => undefined);
        } catch { /* optional channel */ }

        await callback({
          jobId,
          status: "done",
          stage: "다운로드 가능",
          bundle_zip_url: downloadUrl,
          bundle_size: totalPartBytes,
          error_message: null,
        });
      } catch (e) {
        await callback({
          jobId,
          status: "failed",
          error_message: `위챗 전송 실패: ${(e as Error).message}`,
        });
      } finally {
        // Keep parts on disk for the download window. A separate cleanup
        // sweep (cron / next deploy) handles eviction.
        jobCache.delete(jobId);
      }
    } catch (e) {
      await callback({ jobId, status: "failed", error_message: `발주 마무리 실패: ${(e as Error).message}` });
      jobCache.delete(jobId);
    }
  })().catch((e) => console.error("[finalize] async fatal", jobId, e));
}

// Allow client to abort and clean up partial uploads.
export async function abortUpload(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId || "");
  const token = String(req.query.token || "");
  if (!jobId || !token) {
    res.status(400).json({ error: "jobId, token required" });
    return;
  }
  let info: JobInfo;
  try {
    info = await loadJobCached(jobId);
  } catch {
    res.status(204).end();
    return;
  }
  if (!info?.job || (info.job as any).upload_token !== token) {
    res.status(401).json({ error: "invalid upload token" });
    return;
  }
  await rm(sessionDir(jobId), { recursive: true, force: true }).catch(() => undefined);
  jobCache.delete(jobId);
  res.status(204).end();
}

// Per-PNG upload + finalize pipeline.
//
// Browser fans out N parallel PUTs to /orders/:jobId/parts?name=...&token=...
// (one per PNG). The worker writes each body to a session tmp dir. When all
// uploads complete, the browser POSTs /orders/:jobId/finalize?token=... and the
// worker builds the ZIP on disk, uploads it to Storage via the signed URL, and
// sends the bundle to WeChat — same downstream behaviour as the old
// upload-stream route, just without one giant streaming PUT from the browser.

import type { Request, Response } from "express";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fetch } from "undici";
import { fetchBundleInfo, fetchJob, type JobInfo } from "./api.js";
import { callback } from "./callback.js";
import { sendBundleToWeChat } from "./wechat.js";
import { buildZipFile } from "./zipBuilder.js";

const MAX_PART_BYTES = 256 * 1024 * 1024; // 256 MiB per PNG (generous)
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB per order (safety cap)
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;
const STORAGE_UPLOAD_TIMEOUT_MS = 45 * 60 * 1000;

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

async function downloadToFile(url: string, target: string): Promise<number> {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
  // r.body is a web ReadableStream; pipeline accepts it via Readable.fromWeb
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(r.body as any);
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: string | Buffer, _enc, done) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      done(null, buf);
    },
  });
  await pipeline(nodeStream, counter, createWriteStream(target));
  return bytes;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function uploadZipWithProgress(jobId: string, uploadUrl: string, zipPath: string, size: number): Promise<void> {
  let sent = 0;
  let lastCallbackAt = 0;
  let lastPercent = -1;
  const progress = new Transform({
    transform(chunk: string | Buffer, _enc, done) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sent += buf.length;
      const pct = size > 0 ? Math.min(100, Math.floor((sent / size) * 100)) : 0;
      const now = Date.now();
      if (pct === 100 || pct >= lastPercent + 5 || now - lastCallbackAt > 5000) {
        lastPercent = pct;
        lastCallbackAt = now;
        void callback({
          jobId,
          status: "uploading",
          stage: `Storage 업로드 중 (${mb(sent)}MB / ${mb(size)}MB, ${pct}%)`,
          progress_current: Math.round(sent / 1024 / 1024),
          progress_total: Math.max(1, Math.round(size / 1024 / 1024)),
        });
      }
      done(null, buf);
    },
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), STORAGE_UPLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(size),
        "x-upsert": "true",
      },
      body: createReadStream(zipPath).pipe(progress) as any,
      duplex: "half" as any,
      signal: ac.signal,
    } as any);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`storage ${r.status}: ${t.slice(0, 300)}`);
    }
    await callback({
      jobId,
      status: "uploading",
      stage: `Storage 업로드 완료 (${mb(size)}MB, 100%)`,
      progress_current: Math.max(1, Math.round(size / 1024 / 1024)),
      progress_total: Math.max(1, Math.round(size / 1024 / 1024)),
    });
  } finally {
    clearTimeout(timer);
  }
}

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

  // Return immediately. ZIP creation + Storage upload can take minutes for 700MB+
  // bundles, and Render/proxy timeouts otherwise surface as browser CORS + 502.
  res.status(202).json({ ok: true, jobId, parts: parts.length, accepted: true });

  (async () => {
    const zipPath = join(tmpdir(), `order-${jobId}.zip`);
    try {
      // Sum sizes for sanity / progress.
      let totalPartBytes = 0;
      for (const p of parts) {
        try {
          const s = await stat(join(dir, p));
          totalPartBytes += s.size;
          if (totalPartBytes > MAX_TOTAL_BYTES) {
            throw new Error(`parts too large (>${MAX_TOTAL_BYTES})`);
          }
        } catch (e) {
          if ((e as Error).message.startsWith("parts too large")) throw e;
        }
      }

      await callback({
        jobId,
        status: "uploading",
        stage: `ZIP 생성 중 (${parts.length}개 PNG, ${(totalPartBytes / 1024 / 1024).toFixed(1)}MB)`,
        progress_current: 0,
        progress_total: parts.length,
        error_message: null,
      });

      // Optionally include the work order PDF as the first entry.
      let pdfTempPath: string | null = null;
      if (info.work_order_pdf_url) {
        pdfTempPath = join(dir, "__work_order.pdf");
        try {
          await downloadToFile(info.work_order_pdf_url, pdfTempPath);
        } catch (e) {
          console.warn("[finalize] work_order pdf download failed", (e as Error).message);
          pdfTempPath = null;
        }
      }

      const entries = [
        ...(pdfTempPath ? [{ name: "__work_order.pdf", path: pdfTempPath }] : []),
        ...parts
          .filter((n) => n !== "__work_order.pdf")
          .map((n) => ({ name: n, path: join(dir, n) })),
      ];
      let lastZipCallbackAt = 0;
      let lastZipPct = -1;
      const { size } = await buildZipFile(entries, zipPath, (p) => {
        const pct = p.bytesTotal > 0 ? Math.min(100, Math.floor((p.bytesProcessed / p.bytesTotal) * 100)) : 0;
        const now = Date.now();
        if (pct === 100 || pct >= lastZipPct + 10 || now - lastZipCallbackAt > 5000) {
          lastZipPct = pct;
          lastZipCallbackAt = now;
          void callback({
            jobId,
            status: "uploading",
            stage: `ZIP 생성 중 (${p.entriesProcessed}/${p.entriesTotal}개, ${mb(p.bytesProcessed)}MB / ${mb(p.bytesTotal)}MB, ${pct}%)`,
            progress_current: p.entriesProcessed,
            progress_total: Math.max(1, p.entriesTotal),
          });
        }
      });

      await callback({
        jobId,
        status: "uploading",
        stage: `Storage 업로드 시작 (${mb(size)}MB)`,
        progress_current: 0,
        progress_total: Math.max(1, Math.round(size / 1024 / 1024)),
      });

      await uploadZipWithProgress(jobId, info.bundle.upload_url, zipPath, size);

      await callback({
        jobId,
        status: "wechat",
        stage: "위챗 전송 중",
        bundle_zip_path: info.bundle.path,
        bundle_size: size,
        error_message: null,
      });

      try {
        let zipUrl = "";
        try {
          const bundleInfo = await fetchBundleInfo(jobId);
          zipUrl = bundleInfo.bundle_zip_view_url || bundleInfo.bundle_zip_download_url || "";
        } catch (e) {
          console.warn("[finalize] bundle info lookup failed", (e as Error).message);
        }
        await sendBundleToWeChat({
          jobId,
          webhookUrl: info.job.webhook_url,
          orderNo: info.job.order_no,
          zipPath,
          zipSize: size,
          zipFilename: `${info.job.order_no}-bundle.zip`,
          zipUrl,
          itemCount: info.job.progress_total ?? parts.length,
        });
        await callback({ jobId, status: "done", stage: "완료", error_message: null });
      } catch (e) {
        await callback({ jobId, status: "failed", error_message: `위챗 전송 실패: ${(e as Error).message}` });
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
        await rm(zipPath, { force: true }).catch(() => undefined);
        jobCache.delete(jobId);
      }
    } catch (e) {
      await callback({ jobId, status: "failed", error_message: `발주 마무리 실패: ${(e as Error).message}` });
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await rm(zipPath, { force: true }).catch(() => undefined);
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

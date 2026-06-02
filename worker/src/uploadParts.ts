// Per-PNG upload + finalize pipeline (Storage-backed).
//
// Render may run multiple worker instances and /tmp is per-container, so we
// can NOT trust local disk to hold all PNGs between PUTs and finalize. Each
// incoming part is therefore streamed straight to Lovable Cloud Storage via
// a per-part signed upload URL (minted by the worker-part-sign edge fn).
// finalize then asks the edge fn to list the parts and notifies WeChat with
// the streaming download URL. The download endpoint pulls each part back
// from Storage and assembles the ZIP on-the-fly.

import type { Request, Response } from "express";
import { fetch } from "undici";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { fetchJob, type JobInfo, signPart, listParts } from "./api.js";
import { callback } from "./callback.js";
import { sendBundleToWeChat, sendToWeChat } from "./wechat.js";

const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

const jobCache = new Map<string, { info: JobInfo; expiresAt: number }>();
const JOB_CACHE_TTL_MS = 10 * 60 * 1000;

async function loadJobCached(jobId: string): Promise<JobInfo> {
  const hit = jobCache.get(jobId);
  if (hit && hit.expiresAt > Date.now()) return hit.info;
  const info = await fetchJob(jobId);
  jobCache.set(jobId, { info, expiresAt: Date.now() + JOB_CACHE_TTL_MS });
  return info;
}

function safeName(raw: string): string | null {
  if (!raw) return null;
  const base = raw.replace(/[\\/]+/g, "/").split("/").pop() || "";
  if (!base || base.startsWith(".") || /[\u0000-\u001f]/.test(base)) return null;
  if (base.length > 200) return null;
  return base;
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

  try {
    const sig = await signPart(jobId, name);
    const contentLength = Number(req.headers["content-length"] || 0);

    // Pipe the request body straight to Storage. Use a PassThrough so undici
    // gets a proper readable; track bytes for the response payload.
    const pass = new PassThrough();
    let bytes = 0;
    pass.on("data", (c: Buffer) => { bytes += c.length; });
    const piping = pipeline(req, pass);

    const headers: Record<string, string> = {
      "Content-Type": "image/png",
      "x-upsert": "true",
    };
    if (contentLength > 0) headers["Content-Length"] = String(contentLength);

    const putRes = await fetch(sig.upload_url, {
      method: "PUT",
      headers,
      body: pass as any,
      duplex: "half" as any,
    } as any);

    await piping.catch(() => undefined);

    if (!putRes.ok) {
      const t = await putRes.text();
      res.status(502).json({ error: `storage put ${putRes.status}: ${t.slice(0, 200)}` });
      return;
    }
    res.status(200).json({ ok: true, name, bytes, path: sig.path });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
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

  let parts: Array<{ name: string; size: number; url: string }> = [];
  try {
    parts = await listParts(jobId);
  } catch (e) {
    res.status(502).json({ error: `list parts: ${(e as Error).message}` });
    return;
  }
  if (parts.length === 0) {
    res.status(400).json({ error: "no parts uploaded" });
    return;
  }

  const publicBase = (process.env.WORKER_PUBLIC_URL || `https://${req.get("host") || ""}`).replace(/\/$/, "");
  const downloadUrl = `${publicBase}/orders/${jobId}/download-zip?token=${encodeURIComponent(token)}`;
  const totalBytes = parts.reduce((s, p) => s + (p.size || 0), 0);

  res.status(202).json({ ok: true, jobId, parts: parts.length, downloadUrl, accepted: true });

  (async () => {
    try {
      await callback({
        jobId,
        status: "wechat",
        stage: "위챗 전송 중",
        progress_current: parts.length,
        progress_total: parts.length,
        bundle_zip_url: downloadUrl,
        bundle_size: totalBytes,
        error_message: null,
      });

      try {
        const sizeMb = (totalBytes / 1024 / 1024).toFixed(1);
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
          zipSize: Math.max(totalBytes, 50 * 1024 * 1024),
          zipFilename: `${info.job.order_no}-bundle.zip`,
          zipUrl: downloadUrl,
          itemCount: parts.length,
        });
        try { await sendToWeChat("dev", summary).catch(() => undefined); } catch { /* optional */ }

        await callback({
          jobId,
          status: "done",
          stage: "다운로드 가능",
          bundle_zip_url: downloadUrl,
          bundle_size: totalBytes,
          error_message: null,
        });
      } catch (e) {
        await callback({
          jobId,
          status: "failed",
          error_message: `위챗 전송 실패: ${(e as Error).message}`,
        });
      } finally {
        jobCache.delete(jobId);
      }
    } catch (e) {
      await callback({ jobId, status: "failed", error_message: `발주 마무리 실패: ${(e as Error).message}` });
      jobCache.delete(jobId);
    }
  })().catch((e) => console.error("[finalize] async fatal", jobId, e));
}

export async function abortUpload(req: Request, res: Response): Promise<void> {
  const jobId = String(req.params.jobId || "");
  const token = String(req.query.token || "");
  if (!jobId || !token) {
    res.status(400).json({ error: "jobId, token required" });
    return;
  }
  jobCache.delete(jobId);
  res.status(204).end();
}

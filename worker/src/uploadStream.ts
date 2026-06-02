// PUT /orders/:jobId/upload-stream
// Browser streams the ZIP as a chunked PUT (no Content-Length). We accept it,
// buffer it in memory, then upload to Supabase Storage with a real
// Content-Length (signed upload URL accepts that), then trigger WeChat send.
import type { Request, Response } from "express";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetch } from "undici";
import { fetchJob } from "./api.js";
import { callback } from "./callback.js";
import { sendBundleToWeChat } from "./wechat.js";

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB hard cap
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

async function receiveToTempFile(req: Request, jobId: string): Promise<{ path: string; bytes: number }> {
  const path = join(tmpdir(), `order-${jobId}-${randomUUID()}.zip`);
  let lastReported = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        done(new Error(`payload too large (>${MAX_BYTES} bytes)`));
        return;
      }
      if (total - lastReported >= 25 * 1024 * 1024) {
        lastReported = total;
        void callback({
          jobId,
          status: "uploading",
          stage: `ZIP 수신 중 (${(total / 1024 / 1024).toFixed(1)}MB)`,
          error_message: null,
        }).catch((e) => console.warn("[upload-stream] progress callback failed", e));
      }
      done(null, chunk);
    },
  });
  let total = 0;

  try {
    await pipeline(req, counter, createWriteStream(path));
    return { path, bytes: total };
  } catch (e) {
    await rm(path, { force: true }).catch(() => undefined);
    throw e;
  }
}

async function readToBuffer(filePath: string, bytes: number): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > bytes) {
        stream.destroy(new Error("temp file grew unexpectedly"));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks, total)));
    stream.on("error", reject);
  });
}

export async function uploadStream(req: Request, res: Response): Promise<void> {
  req.setTimeout(STREAM_TIMEOUT_MS);
  res.setTimeout(STREAM_TIMEOUT_MS);
  const jobId = String(req.params.jobId || "");
  const token = String(req.query.token || "");
  if (!jobId || !token) {
    res.status(400).json({ error: "jobId and token required" });
    return;
  }

  // 1) Validate token against the job row (worker-fetch-job returns upload_token).
  let info;
  try {
    info = await fetchJob(jobId);
  } catch (e) {
    res.status(502).json({ error: `fetch job: ${(e as Error).message}` });
    return;
  }
  if (!info?.job || (info.job as any).upload_token !== token) {
    res.status(401).json({ error: "invalid upload token" });
    return;
  }

  // 2) Receive the chunked ZIP body to a temp file. `pipeline` rejects on
  // premature browser disconnects; plain `data/end` listeners can hang forever.
  await callback({ jobId, status: "uploading", stage: "ZIP 수신 중", error_message: null });
  let received: { path: string; bytes: number };
  try {
    received = await receiveToTempFile(req, jobId);
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `수신 실패: ${(e as Error).message}` });
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  if (!received.bytes) {
    await callback({ jobId, status: "failed", error_message: "빈 ZIP 수신" });
    res.status(400).json({ error: "empty body" });
    return;
  }

  // 3) Upload to Storage via signed upload URL with a real Content-Length.
  await callback({
    jobId, status: "uploading",
    stage: `Storage 업로드 중 (${(received.bytes / 1024 / 1024).toFixed(1)}MB)`,
  });
  try {
    const r = await fetch(info.bundle.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(received.bytes),
        "x-upsert": "true",
      },
      body: createReadStream(received.path) as any,
      duplex: "half" as any,
    } as any);
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`storage ${r.status}: ${t.slice(0, 300)}`);
    }
  } catch (e) {
    await rm(received.path, { force: true }).catch(() => undefined);
    await callback({ jobId, status: "failed", error_message: `Storage 업로드 실패: ${(e as Error).message}` });
    res.status(502).json({ error: (e as Error).message });
    return;
  }

  await callback({
    jobId,
    status: "wechat",
    stage: "위챗 전송 중",
    bundle_zip_path: info.bundle.path,
    bundle_size: received.bytes,
    error_message: null,
  });

  // 4) Respond to the browser as soon as Storage upload succeeds.
  res.status(200).json({ ok: true, jobId, bytes: received.bytes });

  // 5) Fire off WeChat send (don't block the HTTP response).
  try {
    const zipBytes = await readToBuffer(received.path, received.bytes);
    await sendBundleToWeChat({
      jobId,
      webhookUrl: info.job.webhook_url,
      orderNo: info.job.order_no,
      zipBytes,
      zipFilename: `${info.job.order_no}-bundle.zip`,
      zipUrl: "", // wechat-resend will resolve a fresh signed URL if needed
      itemCount: info.job.progress_total ?? 0,
    });
    await callback({ jobId, status: "done", stage: "완료", error_message: null });
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `위챗 전송 실패: ${(e as Error).message}` });
  } finally {
    await rm(received.path, { force: true }).catch(() => undefined);
  }
}

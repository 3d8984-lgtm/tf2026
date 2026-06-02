// Streaming ZIP download.
//
// PNGs already live on the worker's local /tmp/order-<jobId>-parts/ directory
// (from the earlier /parts uploads). When the user clicks "ZIP 다운로드", the
// browser hits GET /orders/:jobId/download-zip?token=... and we pipe an
// archiver({ store:true }) stream straight to the response. Nothing is buffered
// in memory and nothing is written to Storage — the ZIP exists only for the
// duration of the HTTP response.

import type { Request, Response } from "express";
import archiver from "archiver";
import { createReadStream } from "node:fs";
import { readdir, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchJob, type JobInfo } from "./api.js";

const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

function sessionDir(jobId: string): string {
  return join(tmpdir(), `order-${jobId}-parts`);
}

export async function downloadZip(req: Request, res: Response): Promise<void> {
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
    info = await fetchJob(jobId);
  } catch (e) {
    res.status(502).json({ error: `fetch job: ${(e as Error).message}` });
    return;
  }
  if (!info?.job || (info.job as any).upload_token !== token) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const dir = sessionDir(jobId);
  let parts: string[];
  try {
    parts = (await readdir(dir)).filter((n) => !n.startsWith("."));
  } catch {
    res.status(410).json({ error: "다운로드 만료: 워커에 PNG가 없습니다. 발주를 다시 전송하세요." });
    return;
  }
  if (parts.length === 0) {
    res.status(410).json({ error: "다운로드 만료: PNG가 없습니다." });
    return;
  }

  // Approximate total size for Content-Length isn't possible with store-only zip
  // unless we precompute zip entry overhead. Use chunked transfer instead.
  const filename = `${info.job.order_no}-bundle.zip`;
  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-store");

  const archive = archiver("zip", { store: true });
  let aborted = false;

  archive.on("warning", (err: unknown) => console.warn("[download-zip] warning", jobId, err));
  archive.on("error", (err: Error) => {
    console.error("[download-zip] archive error", jobId, err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.destroy(err);
  });

  res.on("close", () => {
    if (!archive.pointer || !aborted) {
      // Client may have closed early; abort archive to free fds.
      aborted = true;
      try { archive.abort(); } catch { /* noop */ }
    }
  });

  archive.pipe(res);

  // Add work_order pdf first if present locally.
  const pdfPath = join(dir, "__work_order.pdf");
  try {
    await access(pdfPath);
    archive.file(pdfPath, { name: "__work_order.pdf" });
  } catch { /* no pdf, skip */ }

  // Stream each PNG sequentially. archiver internally buffers minimally.
  for (const name of parts) {
    if (aborted) break;
    if (name === "__work_order.pdf") continue;
    const p = join(dir, name);
    try {
      await stat(p);
      archive.append(createReadStream(p), { name });
    } catch (e) {
      console.warn("[download-zip] skip missing part", name, (e as Error).message);
    }
  }

  await archive.finalize();
}

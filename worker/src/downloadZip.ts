// Streaming ZIP download — assembles archive on the fly from Storage parts.
//
// Parts live in Lovable Cloud Storage under orders/<jobId>/parts/*.png.
// We list them via worker-part-sign (action=list), fetch each signed URL,
// pipe the body straight into archiver, and pipe archiver to the response.
// Nothing is buffered beyond a few MB of network backpressure.

import type { Request, Response } from "express";
import archiver from "archiver";
import { Readable } from "node:stream";
import { fetch } from "undici";
import { fetchJob, listParts, type JobInfo } from "./api.js";

const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

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

  let parts: Array<{ name: string; size: number; url: string }>;
  try {
    parts = await listParts(jobId);
  } catch (e) {
    res.status(502).json({ error: `list parts: ${(e as Error).message}` });
    return;
  }
  if (parts.length === 0) {
    res.status(410).json({ error: "다운로드 만료: PNG가 없습니다. 발주를 다시 전송하세요." });
    return;
  }

  // Sort numerically by trailing index so files appear in order (e.g. -1, -2, ... -100).
  parts.sort((a, b) => {
    const ax = Number((a.name.match(/-(\d+)\.png$/i) || [])[1] || 0);
    const bx = Number((b.name.match(/-(\d+)\.png$/i) || [])[1] || 0);
    if (ax !== bx) return ax - bx;
    return a.name.localeCompare(b.name);
  });

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
    if (!aborted) {
      aborted = true;
      try { archive.abort(); } catch { /* noop */ }
    }
  });

  archive.pipe(res);

  // 1) Work order PDF (if present) at the top of the ZIP.
  if (info.work_order_pdf_url) {
    try {
      const r = await fetch(info.work_order_pdf_url);
      if (r.ok && r.body) {
        archive.append(Readable.fromWeb(r.body as any), { name: "작업지시서.pdf" });
      } else {
        console.warn("[download-zip] work_order pdf fetch", jobId, r.status);
      }
    } catch (e) {
      console.warn("[download-zip] work_order pdf error", jobId, (e as Error).message);
    }
  }

  // 2) PNG parts sequentially under "이미지/" (archiver internally serializes anyway).
  for (const p of parts) {
    if (aborted) break;
    try {
      const r = await fetch(p.url);
      if (!r.ok || !r.body) {
        console.warn("[download-zip] part fetch", jobId, p.name, r.status);
        continue;
      }
      const stream = Readable.fromWeb(r.body as any);
      // Strip any leading row index the storage layer added (e.g. "000001-uuid.png")
      // and keep the original "NN_상품명.png" filename produced by the browser.
      const cleanName = p.name.replace(/^\d+-[0-9a-f-]{8,}-/i, "");
      const finalName = `이미지/${cleanName}`;
      await new Promise<void>((resolve, reject) => {
        archive.append(stream, { name: finalName });
        stream.on("end", resolve);
        stream.on("error", reject);
      });
    } catch (e) {
      console.warn("[download-zip] part error", jobId, p.name, (e as Error).message);
    }
  }

  await archive.finalize();
}

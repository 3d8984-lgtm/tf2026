import pLimit from "p-limit";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callback } from "./callback.js";
import { buildItemPng, type ItemMeta } from "./sharpPipeline.js";
import { buildZipFile, type ZipEntry } from "./zipBuilder.js";
import { fetchJob, uploadToSignedUrl, downloadUrl } from "./api.js";
import { sendBundleToWeChat } from "./wechat.js";

const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.IMAGE_CONCURRENCY || 6)));
const MAX_ATTEMPTS = 3;

export async function processJob(jobId: string): Promise<void> {
  console.log(`[job ${jobId}] start`);
  let info;
  try {
    info = await fetchJob(jobId);
  } catch (e) {
    console.warn(`[job ${jobId}] fetch failed`, (e as Error).message);
    await callback({ jobId, status: "failed", error_message: `job fetch failed: ${(e as Error).message}` });
    return;
  }
  const { job, items, bundle, work_order_pdf_url } = info;
  if (job.status === "done") {
    console.log(`[job ${jobId}] already done`);
    return;
  }

  await callback({ jobId, status: "processing", stage: "이미지 가공 시작", error_message: null, progress_current: 0 });

  const total = items.length;
  await callback({ jobId, progress_total: total });

  const workDir = await mkdtemp(join(tmpdir(), `order-${jobId}-`));
  try {
    const limit = pLimit(CONCURRENCY);
    let processed = 0;
    const outputs = new Map<string, { idx: number; filename: string; path: string }>();

    const tasks = items.map((it) =>
      limit(async () => {
        let attempt = it.status === "uploaded" ? 0 : (it.attempts ?? 0);
        let lastErr = "";
        while (attempt < MAX_ATTEMPTS) {
          attempt++;
          await callback({ jobId, item_updates: [{ id: it.id, status: "processing", attempts: attempt }] });
          try {
            const buf = await buildItemPng(it.source_url, (it.meta || {}) as ItemMeta);
            const filePath = join(workDir, `${String(it.idx).padStart(6, "0")}-${it.id}.png`);
            await writeFile(filePath, buf);
            outputs.set(it.id, { idx: it.idx, filename: it.filename || `${it.idx}.png`, path: filePath });
            processed++;
            await callback({
              jobId,
              progress_current: processed,
              stage: `이미지 가공 중 ${processed}/${total}`,
              item_updates: [{ id: it.id, status: "uploaded", attempts: attempt, error_message: null }],
            });
            return;
          } catch (e) {
            lastErr = (e as Error).message;
            console.warn(`[job ${jobId}] item ${it.idx} attempt ${attempt} failed`, lastErr);
            if (attempt >= MAX_ATTEMPTS) {
              await callback({
                jobId,
                item_updates: [{ id: it.id, status: "failed", attempts: attempt, error_message: lastErr }],
              });
              return;
            }
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }),
    );
    await Promise.all(tasks);

    if (processed < total) {
      await callback({
        jobId,
        status: "failed",
        error_message: `이미지 가공 미완료: ${processed}/${total}. 실패 항목을 확인하고 재시도하세요.`,
      });
      return;
    }

    // Build ZIP on disk to avoid keeping hundreds of large PNGs in memory.
    await callback({ jobId, status: "uploading", stage: "ZIP 묶기" });
    const pad = Math.max(2, String(total).length);
    const entries: ZipEntry[] = [];

    if (work_order_pdf_url) {
      try {
        const pdf = await downloadUrl(work_order_pdf_url);
        entries.push({ name: "작업지시서.pdf", data: pdf });
      } catch (e) {
        console.warn(`[job ${jobId}] 작업지시서 PDF 누락:`, (e as Error).message);
      }
    }

    for (const [, v] of outputs) {
      const base = v.filename.replace(/[\\/]/g, "_");
      // If the browser already prefixed a sequence (e.g. "01_상품A.png"),
      // keep it as-is. Otherwise prefix with the row index.
      const hasSeq = /^\d{2,}_/.test(base);
      const fname = hasSeq
        ? (base.endsWith(".png") ? base : base + ".png")
        : `${String(v.idx).padStart(pad, "0")}_${base.endsWith(".png") ? base : base + ".png"}`;
      entries.push({ name: `이미지/${fname}`, path: v.path });
    }

    const zipPath = join(workDir, "bundle.zip");
    let zipSize = 0;
    try {
      const built = await buildZipFile(entries, zipPath);
      zipSize = built.size;
    } catch (e) {
      await callback({ jobId, status: "failed", error_message: `ZIP 생성 실패: ${(e as Error).message}` });
      return;
    }
    outputs.clear();

    try {
      await callback({ jobId, stage: `ZIP 업로드 중 (${(zipSize / 1024 / 1024).toFixed(1)}MB)` });
      await uploadToSignedUrl(bundle.upload_url, createReadStream(zipPath));
    } catch (e) {
      await callback({ jobId, status: "failed", error_message: `ZIP 업로드 실패: ${(e as Error).message}` });
      return;
    }

    // worker-callback auto-generates a signed view URL when only path is provided.
    await callback({
      jobId,
      bundle_zip_path: bundle.path,
      bundle_size: zipSize,
      stage: "위챗 전송 중",
      status: "wechat",
    });

    // Re-fetch to get the signed URL the callback generated (needed for WeChat link fallback).
    let zipUrl = "";
    try {
      const { fetchBundleInfo } = await import("./api.js");
      const bi = await fetchBundleInfo(jobId);
      zipUrl = bi.bundle_zip_view_url || "";
    } catch (e) {
      console.warn(`[job ${jobId}] bundle info fetch failed`, (e as Error).message);
    }

    try {
      await sendBundleToWeChat({
        jobId,
        webhookUrl: job.webhook_url || "",
        orderNo: job.order_no,
        zipPath,
        zipSize,
        zipFilename: `${job.order_no}-bundle.zip`,
        zipUrl,
        itemCount: total,
      });
    } catch (e) {
      await callback({
              jobId,
        status: "failed",
        error_message: `위챗 전송 실패: ${(e as Error).message} (재전송 버튼으로 다시 시도하세요)`,
      });
      return;
    }

    await callback({ jobId, status: "done", stage: "완료", error_message: null });
    console.log(`[job ${jobId}] done (${(zipSize / 1024 / 1024).toFixed(2)}MB)`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

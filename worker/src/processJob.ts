import pLimit from "p-limit";
import { supa } from "./supabase.js";
import { callback } from "./callback.js";
import { buildItemPng, type ItemMeta } from "./sharpPipeline.js";
import { buildZipBuffer, type ZipEntry } from "./zipBuilder.js";
import { uploadBundle, signedUrl, downloadObject } from "./storage.js";
import { sendBundleToWeChat } from "./wechat.js";

const CONCURRENCY = Math.max(1, Math.min(40, Number(process.env.IMAGE_CONCURRENCY || 20)));
const MAX_ATTEMPTS = 3;

export async function processJob(jobId: string): Promise<void> {
  console.log(`[job ${jobId}] start`);
  const { data: job, error } = await supa.from("order_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error || !job) {
    console.warn(`[job ${jobId}] not found`, error?.message);
    return;
  }
  if (job.status === "done") {
    console.log(`[job ${jobId}] already done`);
    return;
  }

  await callback({ jobId, status: "processing", stage: "이미지 가공 시작", error_message: null, progress_current: 0 });

  const { data: items, error: itemsErr } = await supa
    .from("order_job_items")
    .select("id, idx, source_url, filename, meta, status, attempts")
    .eq("job_id", jobId)
    .order("idx", { ascending: true });
  if (itemsErr || !items) {
    await callback({ jobId, status: "failed", error_message: itemsErr?.message || "items load failed" });
    return;
  }
  const total = items.length;
  await callback({ jobId, progress_total: total });

  const limit = pLimit(CONCURRENCY);
  let processed = 0;

  const outputs = new Map<string, { idx: number; filename: string; bytes: Buffer }>();

  const tasks = items.map((it) =>
    limit(async () => {
      if (it.status === "uploaded") {
        processed++;
        await callback({ jobId, progress_current: processed });
        return;
      }
      let attempt = it.attempts ?? 0;
      let lastErr = "";
      while (attempt < MAX_ATTEMPTS) {
        attempt++;
        await callback({
          jobId,
          item_updates: [{ id: it.id, status: "processing", attempts: attempt }],
        });
        try {
          const buf = await buildItemPng(it.source_url, (it.meta || {}) as ItemMeta);
          outputs.set(it.id, { idx: it.idx, filename: it.filename || `${it.idx}.png`, bytes: buf });
          processed++;
          await callback({
            jobId,
            progress_current: processed,
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

  // Strict completion gate
  if (processed < total) {
    await callback({
      jobId,
      status: "failed",
      error_message: `이미지 가공 미완료: ${processed}/${total}. 실패 항목을 확인하고 재시도하세요.`,
    });
    return;
  }

  // Build ZIP
  await callback({ jobId, status: "uploading", stage: "ZIP 묶기" });
  const pad = String(total).length;
  const entries: ZipEntry[] = [];

  // Optional work order PDF from payload
  const pdfPath = (job.payload as any)?.work_order_pdf_path;
  if (typeof pdfPath === "string" && pdfPath) {
    try {
      const pdf = await downloadObject(pdfPath);
      if (pdf) entries.push({ name: "작업지시서.pdf", data: pdf });
    } catch (e) {
      console.warn(`[job ${jobId}] 작업지시서 PDF 누락:`, (e as Error).message);
    }
  }

  for (const [, v] of outputs) {
    const base = v.filename.replace(/[\\/]/g, "_");
    const name = `images/${String(v.idx).padStart(pad, "0")}_${base.endsWith(".png") ? base : base + ".png"}`;
    entries.push({ name, data: v.bytes });
  }

  let zipBytes: Buffer;
  try {
    zipBytes = await buildZipBuffer(entries);
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `ZIP 생성 실패: ${(e as Error).message}` });
    return;
  }
  outputs.clear();

  const zipPath = `orders/${jobId}/bundle.zip`;
  try {
    await callback({ jobId, stage: `ZIP 업로드 중 (${(zipBytes.length / 1024 / 1024).toFixed(1)}MB)` });
    await uploadBundle(zipPath, zipBytes);
  } catch (e) {
    await callback({ jobId, status: "failed", error_message: `ZIP 업로드 실패: ${(e as Error).message}` });
    return;
  }
  const url = await signedUrl(zipPath);
  await callback({
    jobId,
    bundle_zip_path: zipPath,
    bundle_zip_url: url,
    bundle_size: zipBytes.length,
    stage: "위챗 전송 중",
    status: "wechat",
  });

  // WeChat
  try {
    await sendBundleToWeChat({
      jobId,
      webhookUrl: job.webhook_url || "",
      orderNo: job.order_no,
      zipBytes,
      zipFilename: `${job.order_no}-bundle.zip`,
      zipUrl: url,
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
  console.log(`[job ${jobId}] done (${(zipBytes.length / 1024 / 1024).toFixed(2)}MB)`);
}

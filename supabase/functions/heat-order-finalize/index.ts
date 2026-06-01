// Heat-transfer 발주 마무리 잡 처리기.
// 1) 잡 상태 'finalizing' 으로 잠금
// 2) 백그라운드 (EdgeRuntime.waitUntil) 에서
//    - hologram-pdf/orders/heat-transfer-jobs/<jobId>/ 아래 파일들을 스트리밍 ZIP
//    - ZIP 을 hologram-pdf/orders/heat-transfer-<orderNo>-<ts>.zip 으로 업로드
//    - 위챗 webhook 으로 다운로드 링크 전송
//    - outsource_orders insert
//    - 임시 폴더 정리
//    - 잡 status='done' (또는 'failed') 로 갱신
// 즉시 202 응답.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Zip, ZipPassThrough } from "npm:fflate@0.8.2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "hologram-pdf";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // JWT 검증 — 호출자가 로그인되어 있어야 함
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

  let body: { jobId?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const jobId = body.jobId;
  if (!jobId || typeof jobId !== "string") return json({ error: "jobId required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 잡 조회 + 이미 done/finalizing 인 경우 idempotent
  const { data: job, error: jobErr } = await admin
    .from("outsource_order_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return json({ error: jobErr.message }, 500);
  if (!job) return json({ error: "Job not found" }, 404);
  if (job.status === "done") return json({ status: "done", zip_url: job.zip_url }, 200);
  if (job.status === "finalizing") return json({ status: "finalizing" }, 202);

  // 'finalizing' 으로 상태 전환
  const { error: updErr } = await admin
    .from("outsource_order_jobs")
    .update({ status: "finalizing", stage: "서버 ZIP 생성 시작" })
    .eq("id", jobId);
  if (updErr) return json({ error: updErr.message }, 500);

  EdgeRuntime.waitUntil(processJob(admin, job));

  return json({ status: "queued", jobId }, 202);
});

async function setStage(admin: any, jobId: string, stage: string) {
  await admin.from("outsource_order_jobs").update({ stage }).eq("id", jobId);
}

async function fail(admin: any, jobId: string, message: string) {
  console.error(`[job ${jobId}] FAIL`, message);
  await admin.from("outsource_order_jobs")
    .update({ status: "failed", error_message: message.slice(0, 1000) })
    .eq("id", jobId);
}

async function listAllFiles(admin: any, folder: string): Promise<{ name: string }[]> {
  const out: { name: string }[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, {
      limit: pageSize, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (!f.name || f.name.endsWith("/")) continue;
      out.push({ name: f.name });
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function processJob(admin: any, job: any) {
  const jobId: string = job.id;
  const folderName: string = job.order_no || jobId;
  const tmpPrefix = `orders/heat-transfer-jobs/${jobId}`;
  const zipPath = `orders/heat-transfer-${folderName}-${Date.now()}.zip`;

  try {
    await setStage(admin, jobId, "파일 목록 조회 중");
    const files = await listAllFiles(admin, tmpPrefix);
    if (files.length === 0) throw new Error("업로드된 파일이 없습니다");

    // 스트리밍 ZIP 생성 — TransformStream 으로 메모리 폭주 방지
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    let zipError: Error | null = null;
    const zip = new Zip((err, chunk, final) => {
      if (err) { zipError = err as Error; writer.abort(err).catch(() => {}); return; }
      // fire-and-forget; backpressure 는 매번 write 후 awaited
      writer.write(chunk).catch((e) => { zipError = e; });
      if (final) writer.close().catch(() => {});
    });

    // ZIP 빌드와 업로드를 병렬 실행
    const buildPromise = (async () => {
      await setStage(admin, jobId, `ZIP 빌드 중 0/${files.length}`);
      let i = 0;
      for (const f of files) {
        if (zipError) throw zipError;
        const entryName = `${folderName}/${f.name.endsWith(".pdf") ? "" : "Image/"}${f.name === "__work_order.pdf" ? `${folderName}_작업지시서.pdf` : f.name}`;
        const entry = new ZipPassThrough(entryName);
        zip.add(entry);
        const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(`${tmpPrefix}/${f.name}`);
        if (dlErr || !blob) throw new Error(`다운로드 실패 ${f.name}: ${dlErr?.message}`);
        const reader = (blob.stream() as ReadableStream<Uint8Array>).getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) { entry.push(new Uint8Array(0), true); break; }
          if (value && value.byteLength > 0) entry.push(value, false);
        }
        i++;
        if (i % 5 === 0 || i === files.length) await setStage(admin, jobId, `ZIP 빌드 중 ${i}/${files.length}`);
      }
      zip.end();
    })();

    // Supabase Storage 로 ReadableStream 직접 업로드 (REST API)
    await setStage(admin, jobId, "ZIP 업로드 중");
    const uploadPromise = fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${zipPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        "Content-Type": "application/zip",
        "x-upsert": "false",
      },
      body: readable,
      // @ts-ignore Deno fetch supports duplex
      duplex: "half",
    });

    const [, uploadResp] = await Promise.all([buildPromise, uploadPromise]);
    if (!uploadResp.ok) {
      const txt = await uploadResp.text().catch(() => "");
      throw new Error(`Storage 업로드 실패 [${uploadResp.status}] ${txt}`);
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(zipPath);
    const zipUrl = pub.publicUrl;

    // 위챗 전송
    await setStage(admin, jobId, "위챗 전송 중");
    const webhookUrl = (job.webhook_url || "").trim();
    if (webhookUrl) {
      const message = `【열전사 디자인 발주】
작업번호: ${folderName}
디자인 수량: ${files.filter((f) => f.name.endsWith(".png")).length}건
파일: ${folderName}.zip
다운로드: ${zipUrl}`;

      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15_000);
        const wxResp = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content: message } }),
          signal: ac.signal,
        });
        clearTimeout(t);
        if (!wxResp.ok) console.warn(`[job ${jobId}] 위챗 응답 ${wxResp.status}`);
      } catch (e) {
        console.warn(`[job ${jobId}] 위챗 전송 오류`, (e as Error).message);
      }
    }

    // outsource_orders 이력 저장
    await setStage(admin, jobId, "발주 이력 기록 중");
    const pngCount = files.filter((f) => f.name.endsWith(".png")).length;
    const productCode = (job.payload as any)?.product_code || folderName;
    await admin.from("outsource_orders").insert({
      factory: "heat",
      order_no: folderName,
      product_code: productCode,
      quantity: pngCount,
      ordered_at: new Date().toISOString().slice(0, 10),
      status: "ordered",
      note: `위챗 발송 · ${folderName}.zip`,
    });

    // 임시 파일 정리
    await setStage(admin, jobId, "임시 파일 정리 중");
    try {
      const removePaths = files.map((f) => `${tmpPrefix}/${f.name}`);
      // 100개씩 끊어서 삭제
      for (let i = 0; i < removePaths.length; i += 100) {
        await admin.storage.from(BUCKET).remove(removePaths.slice(i, i + 100));
      }
    } catch (e) {
      console.warn(`[job ${jobId}] 임시파일 삭제 실패`, (e as Error).message);
    }

    await admin.from("outsource_order_jobs").update({
      status: "done", stage: "완료", zip_url: zipUrl, error_message: null,
    }).eq("id", jobId);
    console.log(`[job ${jobId}] DONE ${zipUrl}`);
  } catch (e) {
    await fail(admin, jobId, (e as Error).message || String(e));
  }
}

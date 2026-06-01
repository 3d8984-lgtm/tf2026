// Heat-transfer resumable order finalizer.
// The client uploads PNGs and records each item in png_jobs. This function is
// intentionally short-running: each invocation advances the job a small amount,
// updates heartbeat/progress, and asks the client/watchdog to call again when needed.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

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

  let body: { jobId?: string; mode?: "resume" | "watchdog"; zipPath?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const authHeader = req.headers.get("Authorization") || "";
  let systemCall = req.headers.get("x-watchdog-secret") === SERVICE_ROLE_KEY
    || (body.mode === "watchdog" && req.headers.get("apikey") === ANON_KEY);

  if (!systemCall) {
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (body.mode === "watchdog") {
    await admin.rpc("requeue_stale_png_jobs", { _older_than: "30 seconds" });
    const { data: jobs, error } = await admin
      .from("outsource_order_jobs")
      .select("id")
      .eq("factory", "heat")
      .in("status", ["uploading", "finalizing", "failed"])
      .order("updated_at", { ascending: true })
      .limit(5);
    if (error) return json({ error: error.message }, 500);
    const results = [];
    for (const j of jobs || []) results.push(await processJob(admin, j.id));
    return json({ status: "watchdog", results }, 200);
  }

  if (!body.jobId || typeof body.jobId !== "string") return json({ error: "jobId required" }, 400);
  const result = await processJob(admin, body.jobId, body.zipPath);
  return json(result, result.status === "failed" ? 500 : 200);
});

async function setJob(admin: any, jobId: string, patch: Record<string, unknown>) {
  await admin.from("outsource_order_jobs").update(patch).eq("id", jobId);
}

async function failJob(admin: any, jobId: string, message: string) {
  await setJob(admin, jobId, {
    status: "failed",
    stage: "실패",
    error_message: message.slice(0, 1000),
  });
  return { status: "failed", jobId, error: message };
}

async function processJob(admin: any, jobId: string, uploadedZipPath?: string) {
  const { data: job, error: jobErr } = await admin
    .from("outsource_order_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return failJob(admin, jobId, jobErr.message);
  if (!job) return { status: "missing", jobId };
  if (job.status === "done") return { status: "done", jobId, zip_url: job.zip_url };

  const folderName = job.order_no || jobId;
  const zipPath = job.zip_path || `orders/heat-transfer-${folderName}-${Date.now()}-links.txt`;

  try {
    await admin.rpc("requeue_stale_png_jobs", { _older_than: "30 seconds" });

    const { data: counts, error: countErr } = await admin
      .from("png_jobs")
      .select("status")
      .eq("job_id", jobId);
    if (countErr) throw new Error(countErr.message);
    const total = (counts || []).length || job.total_pngs || 0;
    const completed = (counts || []).filter((r: any) => r.status === "completed").length;
    const failed = (counts || []).filter((r: any) => r.status === "failed").length;

    await setJob(admin, jobId, {
      status: completed >= total && total > 0 ? "finalizing" : "uploading",
      uploaded_pngs: completed,
      total_pngs: Math.max(total, job.total_pngs || 0),
      zip_path: zipPath,
      error_message: null,
      stage: completed >= total && total > 0
        ? "서버 ZIP 생성 준비"
        : `PNG 대기/업로드 진행 ${completed}/${Math.max(total, job.total_pngs || 0)}${failed ? ` · 실패 ${failed}` : ""}`,
    });

    if (total === 0 || completed < total) {
      return { status: "waiting_png", jobId, completed, total, failed };
    }

    const finalZipPath = uploadedZipPath || job.zip_path || zipPath;

    const { data: files, error: filesErr } = await admin
      .from("png_jobs")
      .select("item_id, file_url")
      .eq("job_id", jobId)
      .eq("status", "completed")
      .order("item_id", { ascending: true });
    if (filesErr) throw new Error(filesErr.message);

    if ((files || []).length !== total) {
      throw new Error(`PNG 업로드 미완료: completed=${(files || []).length}/${total}`);
    }

    const objectUrls = (files || []).map((f: any) => {
      const { data } = admin.storage.from(BUCKET).getPublicUrl(f.file_url);
      return `${f.item_id}\t${data.publicUrl}`;
    });
    const { data: workOrderPub } = admin.storage.from(BUCKET).getPublicUrl(`orders/heat-transfer-jobs/${jobId}/__work_order.pdf`);
    const linkText = [
      `열전사 디자인 발주 다운로드 목록`,
      `작업번호: ${folderName}`,
      `작업지시서: ${workOrderPub.publicUrl}`,
      `PNG 수량: ${files.length}`,
      "",
      ...objectUrls,
    ].join("\n");
    const { error: linkUploadErr } = await admin.storage.from(BUCKET)
      .upload(finalZipPath, new Blob([linkText], { type: "text/plain;charset=utf-8" }), { contentType: "text/plain;charset=utf-8", upsert: true });
    if (linkUploadErr) throw new Error(`다운로드 링크 파일 생성 실패: ${linkUploadErr.message}`);

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(finalZipPath, 60 * 60 * 24 * 7);
    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(finalZipPath);
    const zipUrl = signed?.signedUrl || pub.publicUrl;

    await setJob(admin, jobId, {
      zip_path: finalZipPath,
      zip_url: zipUrl,
      zip_progress: (files || []).length + 1,
      stage: "ZIP 업로드 확인 완료",
    });

    await setJob(admin, jobId, { stage: "위챗 전송 중" });
    const webhookUrl = (job.webhook_url || "").trim();
    if (webhookUrl) {
      const message = `【열전사 디자인 발주】\n작업번호: ${folderName}\n디자인 수량: ${files.length}건\n파일: 다운로드 링크 목록\n다운로드: ${zipUrl}`;
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 12_000);
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msgtype: "text", text: { content: message } }),
          signal: ac.signal,
        });
        clearTimeout(t);
      } catch (e) {
        console.warn(`[job ${jobId}] 위챗 전송 오류`, (e as Error).message);
      }
    }

    await setJob(admin, jobId, { stage: "발주 이력 기록 중" });
    const productCode = (job.payload as any)?.product_code || folderName;
    await admin.from("outsource_orders").insert({
      factory: "heat",
      order_no: folderName,
      product_code: productCode,
      quantity: files.length,
      ordered_at: new Date().toISOString().slice(0, 10),
      status: "ordered",
      note: `위챗 발송 · ${folderName} 다운로드 링크`,
    });

    await setJob(admin, jobId, {
      status: "done",
      stage: "완료",
      zip_url: zipUrl,
      error_message: null,
      zip_progress: (files || []).length + 1,
    });
    return { status: "done", jobId, zip_url: zipUrl };
  } catch (e) {
    return await failJob(admin, jobId, (e as Error).message || String(e));
  }
}

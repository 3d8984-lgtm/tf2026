import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    const { data: settings } = await supabase
      .from("work_video_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!settings || !settings.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled", deleted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const days = Math.max(1, settings.retention_days ?? 90);
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    let q = supabase
      .from("work_video_records")
      .select("id, bucket, path, has_defect, retain")
      .is("deleted_at", null)
      .lt("created_at", cutoff)
      .eq("retain", false);

    // 불량/클레임 건은 보존
    if (settings.keep_defects) q = q.eq("has_defect", false);

    const { data: rows, error } = await q.limit(500);
    if (error) throw error;

    const targets = rows ?? [];
    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, candidates: targets.length, cutoff }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let deleted = 0;
    const byBucket = new Map<string, string[]>();
    for (const r of targets) {
      const list = byBucket.get(r.bucket) ?? [];
      list.push(r.path);
      byBucket.set(r.bucket, list);
    }
    for (const [bucket, paths] of byBucket) {
      const { error: rmErr } = await supabase.storage.from(bucket).remove(paths);
      if (rmErr) console.error(`storage remove failed [${bucket}]: ${rmErr.message}`);
    }
    if (targets.length > 0) {
      const { error: upErr } = await supabase
        .from("work_video_records")
        .update({ deleted_at: new Date().toISOString() })
        .in("id", targets.map((t) => t.id));
      if (upErr) throw upErr;
      deleted = targets.length;
    }

    await supabase
      .from("work_video_settings")
      .update({ last_run_at: new Date().toISOString(), last_run_deleted: deleted })
      .eq("id", settings.id);

    return new Response(JSON.stringify({ ok: true, deleted, cutoff, retention_days: days }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("work-video-cleanup failed:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

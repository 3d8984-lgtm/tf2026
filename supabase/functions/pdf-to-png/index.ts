import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import * as mupdf from "npm:mupdf@1.3.0";

const CARD_W_MM = 57;
const CARD_H_MM = 87;
const DPI = 300;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { bucket, path, outPath } = await req.json();
    if (!bucket || !path || !outPath) {
      return new Response(JSON.stringify({ error: "bucket, path, outPath required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // download original PDF
    const { data: pdfFile, error: dlErr } = await supabase.storage.from(bucket).download(path);
    if (dlErr || !pdfFile) throw dlErr ?? new Error("PDF download failed");

    const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());

    // render first page at 300 DPI
    const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    const page = doc.loadPage(0);

    // Card target = 57x87mm. Render at 300 DPI -> scale chosen to fit card target
    // PDF page native size (pt) vs target mm: scale = (mm * dpi / 25.4) / nativePt
    const bounds = page.getBounds(); // [x0,y0,x1,y1] in pt
    const nativeWpt = bounds[2] - bounds[0];
    const nativeHpt = bounds[3] - bounds[1];

    const targetWpx = Math.round((CARD_W_MM * DPI) / 25.4);
    const targetHpx = Math.round((CARD_H_MM * DPI) / 25.4);
    const sx = targetWpx / nativeWpt;
    const sy = targetHpx / nativeHpt;

    const matrix = mupdf.Matrix.scale(sx, sy);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pixmap.asPNG();
    pixmap.destroy();
    page.destroy();
    doc.destroy();

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(outPath, new Blob([png], { type: "image/png" }), {
        contentType: "image/png",
        upsert: true,
      });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(outPath);

    return new Response(JSON.stringify({ url: pub.publicUrl, path: outPath }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pdf-to-png error", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

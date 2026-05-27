import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from "npm:pdf-lib@1.17.1";

const MM_TO_PT = 2.8346456693;
const mm = (v: number) => v * MM_TO_PT;
const CARD_W = 57;
const CARD_H = 87;

function hexToRgb(hex?: string | null) {
  if (!hex) return rgb(0, 0, 0);
  const h = hex.replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(s, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

async function fetchBytes(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function drawSide(
  finalPdf: PDFDocument,
  framePdfUrl: string | null,
  elements: any[],
  data: Record<string, any>,
  font: any,
) {
  let page;
  if (framePdfUrl) {
    const frameBytes = await fetchBytes(framePdfUrl);
    const frameDoc = await PDFDocument.load(frameBytes);
    const [copied] = await finalPdf.copyPages(frameDoc, [0]);
    page = finalPdf.addPage(copied);
  } else {
    page = finalPdf.addPage([mm(CARD_W), mm(CARD_H)]);
  }
  // Force exact card size
  page.setSize(mm(CARD_W), mm(CARD_H));

  for (const el of elements) {
    const x = mm(el.x_mm);
    const y = mm(CARD_H - el.y_mm - el.height_mm);
    const w = mm(el.width_mm);
    const h = mm(el.height_mm);
    const rot = degrees(el.rotation_deg || 0);

    if (el.element_type === "text") {
      const text = String(data[el.field_name] ?? "");
      if (!text) continue;
      const size = Number(el.font_size_pt || 10);
      const color = hexToRgb(el.font_color);
      const align = el.text_align || "left";
      const tw = font.widthOfTextAtSize(text, size);
      let tx = x;
      if (align === "center") tx = x + (w - tw) / 2;
      else if (align === "right") tx = x + (w - tw);
      const ty = y + h - size; // baseline correction
      page.drawText(text, { x: tx, y: ty, size, font, color, rotate: rot });
    } else {
      const url = data[el.field_name];
      if (!url || typeof url !== "string") continue;
      try {
        const bytes = await fetchBytes(url);
        const lower = url.toLowerCase().split("?")[0];
        if (lower.endsWith(".pdf")) {
          const tmp = await PDFDocument.load(bytes);
          const [emb] = await finalPdf.embedPdf(tmp, [0]);
          page.drawPage(emb, { x, y, width: w, height: h });
        } else if (lower.endsWith(".png")) {
          const img = await finalPdf.embedPng(bytes);
          page.drawImage(img, { x, y, width: w, height: h, rotate: rot });
        } else {
          // try jpg; fall back to png
          try {
            const img = await finalPdf.embedJpg(bytes);
            page.drawImage(img, { x, y, width: w, height: h, rotate: rot });
          } catch {
            const img = await finalPdf.embedPng(bytes);
            page.drawImage(img, { x, y, width: w, height: h, rotate: rot });
          }
        }
      } catch (e) {
        console.error(`element ${el.field_name} draw failed`, e);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { template_id, data, item_id, return_inline } = body ?? {};
    if (!template_id || !data) {
      return new Response(JSON.stringify({ error: "template_id, data required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tpl, error: tErr } = await supabase
      .from("card_template")
      .select("*")
      .eq("id", template_id)
      .single();
    if (tErr) throw tErr;

    const { data: elements, error: eErr } = await supabase
      .from("card_element")
      .select("*")
      .eq("template_id", template_id)
      .order("z_index");
    if (eErr) throw eErr;

    const finalPdf = await PDFDocument.create();
    const font = await finalPdf.embedFont(StandardFonts.Helvetica);

    await drawSide(
      finalPdf,
      tpl.front_pdf_url,
      (elements ?? []).filter((e: any) => e.side === "front"),
      data,
      font,
    );
    await drawSide(
      finalPdf,
      tpl.back_pdf_url,
      (elements ?? []).filter((e: any) => e.side === "back"),
      data,
      font,
    );

    const pdfBytes = await finalPdf.save();

    if (return_inline) {
      return new Response(pdfBytes, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="card.pdf"',
        },
      });
    }

    const path = `generated/${template_id}/${item_id ?? crypto.randomUUID()}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("card-frames")
      .upload(path, new Blob([pdfBytes], { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("card-frames").getPublicUrl(path);

    if (item_id) {
      await supabase
        .from("card_order_item")
        .update({ pdf_url: pub.publicUrl })
        .eq("id", item_id);
    }

    return new Response(JSON.stringify({ pdf_url: pub.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-card-pdf error", e);
    return new Response(JSON.stringify({ error: String((e as any)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

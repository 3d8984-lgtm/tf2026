// 4PX waybill (100 × 150 mm) renderer.
// Layout follows the 4PX open-platform label spec (ds.xms.label.get, label_100x150):
// destination/service header → service-provider tracking barcode → Ship To →
// Sender → reference / weight / pieces → 4PX tracking barcode → declaration table.

// ---- Code128 (subset B / C auto) -------------------------------------------
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

/** Renders a Code128-B barcode as inline SVG (crisp at any print DPI). */
export function code128Svg(value: string, opts: { height?: number; module?: number } = {}) {
  const text = (value || "").replace(/[^\x20-\x7E]/g, "");
  const height = opts.height ?? 40;
  const module = opts.module ?? 1;
  if (!text) return "";
  const codes: number[] = [104]; // START B
  for (const ch of text) codes.push(ch.charCodeAt(0) - 32);
  let sum = 104;
  codes.slice(1).forEach((c, i) => { sum += c * (i + 1); });
  codes.push(sum % 103);
  codes.push(106); // STOP

  let x = 0;
  let rects = "";
  for (const c of codes) {
    const pattern = CODE128_PATTERNS[c] ?? CODE128_PATTERNS[0];
    let bar = true;
    for (const wChar of pattern) {
      const w = Number(wChar) * module;
      if (bar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
      x += w;
      bar = !bar;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" width="100%" height="100%">${rects}</svg>`;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export interface FpxLabelData {
  carrierName: string;          // 4PX / YUNEXPRESS ...
  trackingNumber: string;       // logistics_channel_no (service provider)
  fpxTrackingNo?: string | null; // 4px_tracking_no
  serviceCode?: string | null;  // logistics_product_code
  refNo?: string | null;        // ref_no (job / external order id)
  createdAt?: string | null;
  weightGrams?: number | null;
  pieces?: number | null;
  test?: boolean;
  recipient: {
    name?: string | null; phone?: string | null; street?: string | null;
    city?: string | null; state?: string | null; zip?: string | null; country?: string | null;
  };
  sender: {
    name?: string | null; company?: string | null; phone?: string | null; street?: string | null;
    city?: string | null; state?: string | null; zip?: string | null; country?: string | null;
  };
  declarations?: Array<{ nameEn?: string | null; nameCn?: string | null; qty?: number | null; price?: number | null; hscode?: string | null }>;
  width?: number;
  height?: number;
}

/**
 * Full-page HTML for a 4PX-format waybill. Identical markup is used for preview and print.
 * `opts.scale` (percent, default 100) compensates for printer drivers that shrink the page:
 * the label is laid out at `size / k` and then scaled by `k`, so it always covers the
 * full physical sheet.
 */
export function buildFpxLabelHtml(d: FpxLabelData, opts: { print?: boolean; scale?: number } = {}) {
  const LW = d.width ?? 100;
  const LH = d.height ?? 150;
  const k = Math.min(3, Math.max(0.5, (opts.scale ?? 100) / 100));
  const IW = +(LW / k).toFixed(3);
  const IH = +(LH / k).toFixed(3);
  const r = d.recipient ?? {};
  const country = (r.country || "US").toUpperCase();
  const date = (d.createdAt ? new Date(d.createdAt) : new Date()).toISOString().slice(0, 16).replace("T", " ");
  const weightKg = ((d.weightGrams ?? 0) / 1000).toFixed(3);
  const decl = (d.declarations ?? []).slice(0, 4);
  const itemLine = decl.length
    ? decl.map((it) => `${esc(it.nameEn || it.nameCn || "item")}*${esc(it.qty ?? 1)}`).join(", ")
    : "-";

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Waybill ${esc(d.trackingNumber)}</title>
<style>
  @page { size: ${LW}mm ${LH}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; width: ${LW}mm; height: ${LH}mm; overflow: hidden; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Helvetica Neue", sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .label { width: ${IW}mm; height: ${IH}mm; padding: 2mm; display: flex; flex-direction: column; position: relative; overflow: hidden; page-break-after: avoid; transform: scale(${k}); transform-origin: top left; }
  @media print {
    html, body { width: ${LW}mm !important; height: ${LH}mm !important; }
    .label { width: ${IW}mm !important; height: ${IH}mm !important; page-break-inside: avoid; }
  }
  .box { border: 0.4mm solid #000; display: flex; flex-direction: column; flex: 1; }
  .hd { display: flex; align-items: center; justify-content: space-between; padding: 2mm 3mm; }
  .hd .brand { font-size: 17pt; font-weight: 800; letter-spacing: -0.4px; }
  .hd .qc { font-size: 9pt; letter-spacing: 3px; }
  .mid { display: flex; border-top: 0.4mm solid #000; }
  .mid .to { flex: 1; padding: 2mm 2.5mm; }
  .mid .to .cap { font-size: 8pt; font-weight: 700; float: left; margin-right: 1.5mm; }
  .mid .to .ad { font-size: 8.5pt; line-height: 1.35; word-break: break-word; }
  .mid .side { width: 26mm; border-left: 0.4mm solid #000; padding: 2mm; display: flex; flex-direction: column; gap: 1.5mm; }
  .mid .side .cc { font-size: 20pt; font-weight: 800; text-align: center; line-height: 1; }
  .mid .side .cell { border: 0.4mm solid #000; height: 9mm; }
  .mid .side .cell.svc { display: flex; align-items: center; justify-content: center; font-size: 12pt; font-weight: 800; }
  .bcwrap { border-top: 0.4mm solid #000; padding: 2mm 3mm 2.5mm; text-align: center; }
  .bcwrap .num { font-family: ui-monospace, Consolas, monospace; font-size: 10pt; letter-spacing: 1px; margin-bottom: 1mm; }
  .bcwrap .bc { height: 17mm; }
  .info { border-top: 0.4mm solid #000; padding: 2mm 3mm; font-size: 8pt; line-height: 1.5; }
  .info .row1 { display: flex; justify-content: space-between; align-items: baseline; }
  .info .ref { font-size: 9pt; }
  .info .ref b { font-size: 10pt; }
  .foot { margin-top: auto; display: flex; justify-content: space-between; font-size: 6pt; color: #333; padding: 1mm 3mm; }
  .test { position: absolute; top: 45mm; left: 0; width: ${IW}mm; text-align: center; font-size: 32pt; font-weight: 900; color: rgba(0,0,0,.12); transform: rotate(-20deg); letter-spacing: 4px; }
</style></head><body>
<div class="label">
  ${d.test ? `<div class="test">TEST</div>` : ""}
  <div class="box">
    <div class="hd">
      <div class="brand">${esc(d.carrierName)}</div>
      <div class="qc">QC QC</div>
    </div>

    <div class="mid">
      <div class="to">
        <div class="cap">TO:</div>
        <div class="ad">${esc(r.name)}<br/>
          ${esc(r.street)}<br/>
          ${esc([r.zip, r.city, r.state].filter(Boolean).join("; "))}<br/>
          TEL ${esc(r.phone)}</div>
      </div>
      <div class="side">
        <div class="cc">${esc(country)}</div>
        <div class="cell"></div>
        <div class="cell svc">${esc(d.serviceCode || "S")}</div>
      </div>
    </div>

    <div class="bcwrap">
      <div class="num">${esc(d.trackingNumber)}</div>
      <div class="bc">${code128Svg(d.trackingNumber, { height: 40 })}</div>
    </div>

    <div class="info">
      <div class="row1">
        <span>【${esc(d.fpxTrackingNo || d.refNo || "-")}】&nbsp;&nbsp;Print time: ${esc(date)}</span>
        <b>GW: ${weightKg} kg</b>
      </div>
      <div class="ref">Ref No: <b>${esc(d.refNo || "-")}</b></div>
      <div>${itemLine}</div>
    </div>
  </div>

</div>
${opts.print ? "<script>window.onload=()=>{setTimeout(()=>window.print(),200)};<\/script>" : ""}
</body></html>`;
}


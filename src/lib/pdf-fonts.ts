// Spoqa Han Sans Neo — bundled TTFs for both web preview (@font-face) and pdf-lib vector embedding.
import spoqaRegularUrl from "@/assets/fonts/SpoqaHanSansNeo-Regular.ttf?url";
import spoqaMediumUrl from "@/assets/fonts/SpoqaHanSansNeo-Medium.ttf?url";
import spoqaBoldUrl from "@/assets/fonts/SpoqaHanSansNeo-Bold.ttf?url";

const STYLE_ID = "spoqa-han-sans-neo-local";

export function ensureSpoqaFontFace() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @font-face { font-family: 'Spoqa Han Sans Neo'; src: url('${spoqaRegularUrl}') format('truetype'); font-weight: 100 449; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Spoqa Han Sans Neo'; src: url('${spoqaMediumUrl}') format('truetype'); font-weight: 450 649; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Spoqa Han Sans Neo'; src: url('${spoqaBoldUrl}') format('truetype'); font-weight: 650 900; font-style: normal; font-display: swap; }
  `;
  document.head.appendChild(style);
}

function pickUrl(weight: number): string {
  if (weight >= 650) return spoqaBoldUrl;
  if (weight >= 450) return spoqaMediumUrl;
  return spoqaRegularUrl;
}

const _bytesCache = new Map<string, Uint8Array>();
export async function loadSpoqaFontBytes(weight: number): Promise<Uint8Array> {
  const url = pickUrl(weight);
  const cached = _bytesCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  const buf = new Uint8Array(await res.arrayBuffer());
  _bytesCache.set(url, buf);
  return buf;
}

export async function waitForSpoqaLoaded(weight: number): Promise<void> {
  try {
    await (document as any).fonts?.load(`${weight} 16px 'Spoqa Han Sans Neo'`);
  } catch {}
}

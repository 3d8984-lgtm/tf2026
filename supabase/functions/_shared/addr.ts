// 4PX 등 해외 택배사는 수취인 정보에 영문/기호만 허용하며 city/state가 필수입니다.
// 한글 이름은 국어의 로마자 표기법(개정)으로 변환하고, 주소에서 city/state를 보정합니다.

const CHO = ["g","kk","n","d","tt","r","m","b","pp","s","ss","","j","jj","ch","k","t","p","h"];
const JUNG = ["a","ae","ya","yae","eo","e","yeo","ye","o","wa","wae","oe","yo","u","wo","we","wi","yu","eu","ui","i"];
const JONG = ["","k","k","k","n","n","n","t","l","l","l","l","l","l","l","l","m","p","p","t","t","ng","t","t","k","t","p","t"];

export function romanizeKorean(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const i = code - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else {
      out += ch;
    }
  }
  return out;
}

/** 영문/숫자/기본 기호만 남기고, 알파벳이 하나도 없으면 fallback 사용 */
export function toLatinName(raw: string | null | undefined, fallback = "Customer"): string {
  const romanized = romanizeKorean(String(raw ?? ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const cleaned = romanized.replace(/[^A-Za-z0-9 .,'\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]/.test(cleaned)) return fallback;
  // 첫 글자 대문자화
  return cleaned
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .slice(0, 60);
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.split(" ").filter(Boolean);
  if (parts.length <= 1) return { first: full, last: full };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","GU","VI","AA","AE","AP",
]);

/** "123 Main St, Miami, FL 33101" 형태에서 city/state/zip 추출 */
export function parseUsAddress(address: string): { city: string; state: string; zip: string } {
  const clean = String(address ?? "").replace(/\s+/g, " ").trim();
  const zip = clean.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";
  const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
  let state = "";
  let city = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const tokens = parts[i].replace(/\d{5}(-\d{4})?/, "").trim().split(" ").filter(Boolean);
    const abbr = tokens.find((t) => US_STATES.has(t.toUpperCase().replace(/\./g, "")));
    if (abbr) {
      state = abbr.toUpperCase().replace(/\./g, "");
      city = parts[i - 1] ?? tokens.filter((t) => t !== abbr).join(" ");
      break;
    }
  }
  if (!city && parts.length >= 2) city = parts[parts.length - 2];
  return { city: toLatinName(city, ""), state, zip };
}

export function normalizeRecipient(order: {
  recipient_name?: string | null;
  shipping_address?: string | null;
  shipping_city?: string | null;
  shipping_state?: string | null;
  shipping_zip?: string | null;
  shipping_country?: string | null;
}) {
  const parsed = parseUsAddress(order.shipping_address ?? "");
  const name = toLatinName(order.recipient_name);
  const { first, last } = splitName(name);
  const city = toLatinName(order.shipping_city ?? "", "") || parsed.city;
  const state = (order.shipping_state ?? "").trim() || parsed.state;
  const zip = (order.shipping_zip ?? "").trim() || parsed.zip;
  const street = toLatinName(order.shipping_address ?? "", "") ||
    String(order.shipping_address ?? "").replace(/[^\x20-\x7E]/g, " ").trim();
  return {
    name,
    first_name: first,
    last_name: last,
    street: street.slice(0, 200),
    city,
    state,
    zip,
    country: (order.shipping_country ?? "US").toUpperCase(),
    missing: [
      city ? null : "city",
      state ? null : "state",
      zip ? null : "zip",
    ].filter(Boolean) as string[],
  };
}

// Shared helpers for hardware barcode/QR scanners.
// Scanners emit US-QWERTY key codes, so decoding from `event.code` keeps
// scanning immune to the active OS input language (Korean IME, etc.).

const HANGUL_JAMO_MAP: Record<string, string> = {
  "ㅂ":"q","ㅈ":"w","ㄷ":"e","ㄱ":"r","ㅅ":"t","ㅛ":"y","ㅕ":"u","ㅑ":"i","ㅐ":"o","ㅔ":"p",
  "ㅁ":"a","ㄴ":"s","ㅇ":"d","ㄹ":"f","ㅎ":"g","ㅗ":"h","ㅓ":"j","ㅏ":"k","ㅣ":"l",
  "ㅋ":"z","ㅌ":"x","ㅊ":"c","ㅍ":"v","ㅠ":"b","ㅜ":"n","ㅡ":"m",
  "ㅃ":"Q","ㅉ":"W","ㄸ":"E","ㄲ":"R","ㅆ":"T","ㅒ":"O","ㅖ":"P",
};
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];

export function hangulToQwerty(input: string): string {
  if (!input) return input;
  let hasHangul = false;
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      hasHangul = true;
      const s = code - 0xAC00;
      const cho = CHO[Math.floor(s / 588)];
      const jung = JUNG[Math.floor((s % 588) / 28)];
      const jong = JONG[s % 28];
      for (const j of [cho, jung, jong]) {
        if (!j) continue;
        for (const k of j) out += HANGUL_JAMO_MAP[k] ?? k;
      }
    } else if (HANGUL_JAMO_MAP[ch] !== undefined) {
      hasHangul = true;
      out += HANGUL_JAMO_MAP[ch];
    } else {
      out += ch;
    }
  }
  return hasHangul ? out : input;
}

const CODE_CHAR_MAP: Record<string, [string, string]> = (() => {
  const map: Record<string, [string, string]> = {};
  for (const c of "abcdefghijklmnopqrstuvwxyz") map[`Key${c.toUpperCase()}`] = [c, c.toUpperCase()];
  const digits: Record<string, string> = { "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")" };
  for (const [d, s] of Object.entries(digits)) {
    map[`Digit${d}`] = [d, s];
    map[`Numpad${d}`] = [d, d];
  }
  Object.assign(map, {
    Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
    Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'], Backquote: ["`", "~"],
    Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Space: [" ", " "],
    NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"], NumpadDecimal: [".", "."],
    NumpadMultiply: ["*", "*"], NumpadDivide: ["/", "/"],
  } as Record<string, [string, string]>);
  return map;
})();

/** Latin character for a keydown event regardless of the active IME. */
export function latinCharFromEvent(e: KeyboardEvent): string | null {
  const mapped = CODE_CHAR_MAP[e.code];
  if (mapped) return e.shiftKey ? mapped[1] : mapped[0];
  if (e.key.length === 1) return hangulToQwerty(e.key);
  return null;
}

/** Canonicalize scanned/stored codes (unicode dashes, invisible separators). */
export function normalizeScan(input: string): string {
  return hangulToQwerty(input || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .trim()
    .toUpperCase();
}

export const SCANNER_BLOCKED_KEYS = new Set([
  "Tab", "Escape", "F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12",
  "BrowserSearch", "BrowserHome", "BrowserBack", "BrowserForward",
]);

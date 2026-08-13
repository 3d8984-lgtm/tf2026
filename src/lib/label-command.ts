/**
 * 라벨/코딩 프린터 명령 생성기.
 *
 * 게이트웨이(`POST /api/v1/print/test`)는 전달된 `text`를 USB 시리얼 포트로 그대로 흘려보낸다.
 * 즉, "무엇을 인쇄할지"는 전적으로 이 문자열(프린터 명령어)에 달려 있다.
 *
 * 현장 증상별 원인:
 * - 아무것도 안 나온다 → 명령에 `PRINT`(TSPL) / `^XZ`(ZPL) 같은 출력 실행 명령이 없음
 * - 프린터에 저장된 기본 QR이 나온다 → 프린터가 "템플릿 + 변수 데이터" 모드라서
 *   우리가 보낸 명령을 해석하지 못하고, 저장된 템플릿을 그대로 찍음
 *   → 이 경우 `raw` 모드(값 + 종결문자)로 변수 데이터만 보내야 한다
 *
 * 프린터 기종을 알 수 없으므로 여러 프로토콜을 전환/진단할 수 있게 만들었다.
 * 게이트웨이의 `text`는 최대 200자라서, 명령은 꼭 필요한 줄만 사용한다.
 */

export type LabelMode =
  | "tspl-barcode"
  | "tspl-qr"
  | "zpl-qr"
  | "zpl-barcode"
  | "epl-barcode"
  | "raw";

export type Terminator = "crlf" | "cr" | "lf" | "none";

export type LabelOptions = {
  mode: LabelMode;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  /** raw 모드 종결 문자 — 템플릿형 코딩 프린터는 보통 CR 또는 CRLF로 한 건을 확정한다 */
  terminator: Terminator;
  /** raw 모드에서 값 앞뒤에 붙일 문자열 (프린터 변수 필드 규격에 맞출 때 사용) */
  prefix: string;
  suffix: string;
};

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  mode: "tspl-barcode",
  widthMm: 40,
  heightMm: 30,
  gapMm: 2,
  terminator: "crlf",
  prefix: "",
  suffix: "",
};

export const LABEL_MODE_LABELS: Record<LabelMode, { ko: string; zh: string }> = {
  "tspl-barcode": { ko: "TSPL · 바코드(Code128)", zh: "TSPL · 条码(Code128)" },
  "tspl-qr": { ko: "TSPL · QR", zh: "TSPL · 二维码" },
  "zpl-qr": { ko: "ZPL · QR (Zebra 계열)", zh: "ZPL · 二维码 (Zebra)" },
  "zpl-barcode": { ko: "ZPL · 바코드(Code128)", zh: "ZPL · 条码(Code128)" },
  "epl-barcode": { ko: "EPL2 · 바코드(Code128)", zh: "EPL2 · 条码(Code128)" },
  raw: { ko: "원시 데이터 (프린터 내장 템플릿용)", zh: "原始数据（打印机内置模板）" },
};

/** 진단 순서 — 위에서부터 하나씩 보내며 실제 출력되는 프로토콜을 찾는다 */
export const PROBE_MODES: LabelMode[] = [
  "tspl-barcode",
  "tspl-qr",
  "zpl-qr",
  "zpl-barcode",
  "epl-barcode",
  "raw",
];

/** TSPL/ZPL 문자열 리터럴 이스케이프 */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** 8 dots/mm (203dpi) 기준 좌표 변환 */
const dots = (mm: number) => Math.max(0, Math.round(mm * 8));

const term = (t: Terminator) => (t === "crlf" ? "\r\n" : t === "cr" ? "\r" : t === "lf" ? "\n" : "");

export function buildLabelCommand(code: string, opts: LabelOptions): string {
  const value = (code || "").trim();
  const w = dots(opts.widthMm);
  const h = dots(opts.heightMm);

  if (opts.mode === "raw") {
    return `${opts.prefix}${value}${opts.suffix}${term(opts.terminator)}`;
  }

  if (opts.mode === "zpl-qr" || opts.mode === "zpl-barcode") {
    // ZPL: ^XA ... ^XZ 로 감싸야 실제 출력된다. ^LL/^PW로 라벨 크기를 알려준다.
    const body =
      opts.mode === "zpl-qr"
        ? `^FO40,40^BQN,2,6^FDQA,${value}^FS`
        : `^FO30,40^BCN,${Math.max(40, Math.round(h * 0.45))},N,N,N^FD${value}^FS`;
    return `^XA^PW${w}^LL${h}${body}^PQ1^XZ\r\n`;
  }

  if (opts.mode === "epl-barcode") {
    // EPL2: q(폭) Q(높이,갭) N(버퍼 클리어) B(바코드) P1(출력)
    return [
      `q${w}`,
      `Q${h},${dots(opts.gapMm)}`,
      "N",
      `B30,40,0,1,2,4,${Math.max(40, Math.round(h * 0.45))},N,"${esc(value)}"`,
      "P1",
    ].join("\r\n") + "\r\n";
  }

  // TSPL
  const lines: string[] = [
    `SIZE ${opts.widthMm} mm,${opts.heightMm} mm`,
    `GAP ${opts.gapMm} mm,0 mm`,
    "DIRECTION 1",
    "CLS",
  ];

  if (opts.mode === "tspl-qr") {
    const cell = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 40)));
    lines.push(`QRCODE ${Math.round(w * 0.12)},${Math.round(h * 0.12)},M,${cell},A,0,"${esc(value)}"`);
  } else {
    const barHeight = Math.max(30, Math.round(h * 0.45));
    lines.push(`BARCODE ${Math.round(w * 0.08)},${Math.round(h * 0.2)},"128",${barHeight},1,0,2,4,"${esc(value)}"`);
  }

  lines.push("PRINT 1,1");
  return lines.join("\r\n") + "\r\n";
}

/**
 * 라벨 프린터 명령 생성기.
 *
 * 게이트웨이(`POST /api/v1/print/test`)는 전달된 `text`를 USB 시리얼 포트로 그대로 흘려보낸다.
 * 갭 센서가 달린 라벨 프린터는 "문자열"만 받아서는 절대 출력하지 않는다 —
 * 라벨 크기/갭 정의와 `PRINT` 실행 명령이 포함된 프린터 명령어(TSPL 등)를 받아야
 * 센서로 라벨 위치를 잡고 실제 인쇄를 시작한다.
 * (그래서 대기열은 `done`인데 실물 출력은 나오지 않는다.)
 */

export type LabelMode = "tspl-barcode" | "tspl-qr" | "raw";

export type LabelOptions = {
  mode: LabelMode;
  widthMm: number;
  heightMm: number;
  gapMm: number;
  /** 인쇄 농도 0~15 */
  density: number;
  /** 인쇄 속도 (in/s) */
  speed: number;
};

export const DEFAULT_LABEL_OPTIONS: LabelOptions = {
  mode: "tspl-barcode",
  widthMm: 40,
  heightMm: 30,
  gapMm: 2,
  density: 8,
  speed: 4,
};

/** TSPL 문자열 리터럴 이스케이프 */
const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** 8 dots/mm (203dpi) 기준 좌표 변환 */
const dots = (mm: number) => Math.max(0, Math.round(mm * 8));

export function buildLabelCommand(code: string, opts: LabelOptions): string {
  const value = esc((code || "").trim());
  if (opts.mode === "raw") return value;

  const w = dots(opts.widthMm);
  const h = dots(opts.heightMm);
  const head: string[] = [
    `SIZE ${opts.widthMm} mm,${opts.heightMm} mm`,
    `GAP ${opts.gapMm} mm,0 mm`,
    "DIRECTION 1",
    "REFERENCE 0,0",
    `DENSITY ${Math.min(15, Math.max(0, Math.round(opts.density)))}`,
    `SPEED ${opts.speed}`,
    "CLS",
  ];

  if (opts.mode === "tspl-qr") {
    const cell = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 40)));
    head.push(`QRCODE ${Math.round(w * 0.12)},${Math.round(h * 0.12)},M,${cell},A,0,"${value}"`);
    head.push(`TEXT ${Math.round(w * 0.12)},${Math.round(h * 0.8)},"1",0,1,1,"${value}"`);
  } else {
    const barHeight = Math.max(30, Math.round(h * 0.45));
    head.push(`BARCODE ${Math.round(w * 0.08)},${Math.round(h * 0.2)},"128",${barHeight},1,0,2,4,"${value}"`);
  }

  head.push("PRINT 1,1");
  return head.join("\r\n") + "\r\n";
}

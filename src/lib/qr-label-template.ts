// QR 라벨 템플릿 (서버 공통 설정, mm 단위가 Source of Truth).
// app_ui_settings.setting_key = QR_LABEL_TEMPLATE_KEY 한 행에 저장되어
// 모든 PC/사용자가 동일한 설정을 사용한다.

export const QR_LABEL_TEMPLATE_KEY = "tshirt_packaging_qr_default";

export type QrErrorLevel = "L" | "M" | "Q" | "H";
export type QrLabelTemplate = {
  template_name: string;
  // 라벨 규격 (mm)
  /** 라벨 모양 — rect = 사각, round = 원형(지름 = label_width) */
  label_shape: "rect" | "round";
  label_width: number;
  label_height: number;
  columns: number;
  horizontal_gap: number;
  vertical_gap: number;
  margin_top: number;
  margin_bottom: number;
  margin_left: number;
  margin_right: number;
  orientation: "portrait" | "landscape";
  dpi: number;
  // QR (mm)
  /** 좌표 기준 — "center" = qr_x/qr_y 가 QR 중심점 (라벨 좌상단 기준) */
  qr_anchor: "center";
  /** QR 중심 X (라벨 좌측 기준, mm) */
  qr_x: number;
  /** QR 중심 Y (라벨 상단 기준, mm) */
  qr_y: number;
  qr_width: number;
  qr_height: number;
  qr_error_level: QrErrorLevel;
  qr_quiet_zone: number;
  // Edition Number
  edition_x: number;
  edition_y: number;
  edition_font_size: number; // pt
  edition_font_family: string;
  edition_font_weight: "normal" | "bold";
  edition_alignment: "left" | "center" | "right";
  /** 에디션 넘버 배치 — outside = QR 옆(기존), qr_center = QR 코드 중앙 삽입 */
  edition_placement: "outside" | "qr_center";
  /** QR 중앙 삽입 시 흰색 박스 가로(mm) — 인식률 보호를 위해 자동 상한 적용 */
  edition_center_width: number;
  /** QR 중앙 삽입 시 흰색 박스 세로(mm) — 인식률 보호를 위해 자동 상한 적용 */
  edition_center_height: number;
  /** QR 중앙 기준 X 오프셋(mm) */
  edition_center_offset_x: number;
  /** QR 중앙 기준 Y 오프셋(mm) */
  edition_center_offset_y: number;
  // 프린터
  printer_name: string;          // Windows Printer Name
  printer_display_name: string;  // 화면 표시 이름
  printer_model: string;
  printer_max_print_width: number;  // mm
  printer_max_media_width: number;  // mm
  printer_dpi: number;
  printer_connection: "usb" | "network" | "serial";
  /** local = 이 PC에 연결된 프린터(브라우저 인쇄), bridge = 네트워크/로컬 브리지 프로그램 */
  print_mode: "local" | "bridge";
  bridge_enabled: boolean;
  bridge_url: string;
  // 인쇄 설정
  /** 전체 인쇄 시 역순(마지막 번호부터) 출력 */
  reverse_print: boolean;
  /** 본 인쇄 앞에 넣을 시험 인쇄 매수 */
  test_before_count: number;
  /** 본 인쇄 뒤에 넣을 시험 인쇄 매수 */
  test_after_count: number;
  /** 시험 라벨 QR 내용 */
  test_label_code: string;
  /** 시험 라벨 하단 텍스트 */
  test_label_text: string;
};

export const QR_LABEL_DEFAULTS: QrLabelTemplate = {
  template_name: QR_LABEL_TEMPLATE_KEY,
  label_shape: "rect",
  label_width: 30,
  label_height: 20,
  columns: 1,
  horizontal_gap: 2,
  vertical_gap: 2,
  margin_top: 0,
  margin_bottom: 0,
  margin_left: 0,
  margin_right: 0,
  orientation: "landscape",
  dpi: 203,
  qr_anchor: "center",
  qr_x: 10,
  qr_y: 10,
  qr_width: 16,
  qr_height: 16,
  qr_error_level: "H",
  qr_quiet_zone: 1,
  edition_x: 20,
  edition_y: 9,
  edition_font_size: 8,
  edition_font_family: "Arial",
  edition_font_weight: "bold",
  edition_alignment: "left",
  edition_placement: "qr_center",
  edition_center_width: 8,
  edition_center_height: 2.5,
  edition_center_offset_x: 0,
  edition_center_offset_y: 0,
  printer_name: "QIRUI T300",
  printer_display_name: "Qirui T300",
  printer_model: "Qirui T300 / 启锐 T300",
  printer_max_print_width: 108,
  printer_max_media_width: 118,
  printer_dpi: 203,
  printer_connection: "usb",
  print_mode: "local",
  bridge_enabled: false,
  bridge_url: "http://127.0.0.1:9110",
  reverse_print: true,
  test_before_count: 0,
  test_after_count: 0,
  test_label_code: "TEST",
  test_label_text: "TEST",
};

/**
 * 오류정정 레벨별로 "가려도 안전한" QR 면적 비율.
 * 실제 디코딩 테스트(jsQR, 다양한 데이터 길이)로 검증한 보수적 상한이며,
 * 여기에 가로 60% / 세로 20% 제한이 함께 적용된다.
 */
export const EC_SAFE_AREA: Record<QrErrorLevel, number> = { L: 0.02, M: 0.04, Q: 0.07, H: 0.09 };

export type CenterBox = {
  /** mm 좌표 (라벨 기준) */
  x: number; y: number; w: number; h: number;
  /** 허용 최대치(mm) */
  maxW: number; maxH: number;
  /** 박스에 들어갈 수 있는 최대 글자 크기(pt) */
  maxFontPt: number;
};

const clampNum = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * QR 중앙 에디션 박스의 최종 위치/크기(mm).
 * 가로는 QR의 60%, 세로는 20%를 넘지 않으며, 전체 면적은 EC_SAFE_AREA 이내로 강제된다.
 */
export function resolveCenterBox(t: QrLabelTemplate): CenterBox {
  const qw = Math.max(1, Number(t.qr_width) || 1);
  const qh = Math.max(1, Number(t.qr_height) || 1);
  const maxArea = qw * qh * EC_SAFE_AREA[t.qr_error_level];
  const maxW = Math.min(qw * 0.6, maxArea / Math.max(0.3, qh * 0.08));
  const w = clampNum(Number(t.edition_center_width) || 1, 1, Math.round(maxW * 100) / 100);
  const maxH = Math.min(qh * 0.2, maxArea / w);
  const h = clampNum(Number(t.edition_center_height) || 1, 0.5, Math.round(maxH * 100) / 100);
  // qr_x/qr_y 는 이미 QR 중심점 좌표
  const cx = (Number(t.qr_x) || 0) + (Number(t.edition_center_offset_x) || 0);
  const cy = (Number(t.qr_y) || 0) + (Number(t.edition_center_offset_y) || 0);
  return {
    x: cx - w / 2, y: cy - h / 2, w, h,
    maxW: Math.round(maxW * 100) / 100,
    maxH: Math.round(maxH * 100) / 100,
    maxFontPt: Math.round(h * 0.8 * (72 / 25.4) * 10) / 10,
  };
}

/** 중앙 삽입 시 실제 사용할 글자 크기(pt) — 박스를 넘지 않도록 제한 */
export function centerFontPt(t: QrLabelTemplate, box: CenterBox, text: string): number {
  const byHeight = box.maxFontPt;
  // 대략적인 문자폭(0.55em) 기준으로 가로도 넘지 않게 축소
  const byWidth = (box.w * (72 / 25.4)) / Math.max(1, text.length * 0.58);
  return Math.max(2, Math.min(t.edition_font_size, byHeight, byWidth));
}

export function mergeTemplate(raw: unknown): QrLabelTemplate {
  const v = { ...((raw ?? {}) as Partial<QrLabelTemplate>) };
  // 구버전(좌상단 기준) 저장값 1회성 변환: qr_anchor 가 없던 시절 값이면 중심 좌표로 환산
  if (v.qr_anchor !== "center") {
    const qw = Number(v.qr_width ?? QR_LABEL_DEFAULTS.qr_width) || 0;
    const qh = Number(v.qr_height ?? QR_LABEL_DEFAULTS.qr_height) || 0;
    if (typeof v.qr_x === "number") v.qr_x = Math.round((v.qr_x + qw / 2) * 100) / 100;
    if (typeof v.qr_y === "number") v.qr_y = Math.round((v.qr_y + qh / 2) * 100) / 100;
  }
  return { ...QR_LABEL_DEFAULTS, ...v, qr_anchor: "center", template_name: QR_LABEL_TEMPLATE_KEY };
}

/** QR 중심 좌표 → 좌상단 좌표 (렌더링/인쇄용) */
export function qrTopLeft(t: Pick<QrLabelTemplate, "qr_x" | "qr_y" | "qr_width" | "qr_height">) {
  return {
    x: (Number(t.qr_x) || 0) - (Number(t.qr_width) || 0) / 2,
    y: (Number(t.qr_y) || 0) - (Number(t.qr_height) || 0) / 2,
  };
}

/** 현재 배열이 필요로 하는 전체 출력 폭(mm) */
export function requiredWidthMm(t: QrLabelTemplate): number {
  const cols = Math.max(1, Math.round(t.columns));
  return (
    t.label_width * cols +
    t.horizontal_gap * (cols - 1) +
    t.margin_left +
    t.margin_right
  );
}

export type WidthCheck = { requiredMm: number; maxMm: number; ok: boolean };

export function checkWidth(t: QrLabelTemplate): WidthCheck {
  const requiredMm = Math.round(requiredWidthMm(t) * 100) / 100;
  const maxMm = t.printer_max_print_width;
  return { requiredMm, maxMm, ok: requiredMm <= maxMm + 1e-6 };
}

/** 001/100 형태의 Edition Number */
export function formatEdition(value: unknown, position: number, total: number): string {
  const raw = String(value ?? "").trim();
  if (raw && raw.includes("/")) return raw;
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : position;
  const pad = Math.max(3, String(total).length);
  return `${String(n).padStart(pad, "0")}/${total}`;
}

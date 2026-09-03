// QR 라벨 템플릿 (서버 공통 설정, mm 단위가 Source of Truth).
// app_ui_settings.setting_key = QR_LABEL_TEMPLATE_KEY 한 행에 저장되어
// 모든 PC/사용자가 동일한 설정을 사용한다.

export const QR_LABEL_TEMPLATE_KEY = "tshirt_packaging_qr_default";

export type QrErrorLevel = "L" | "M" | "Q" | "H";
export type QrLabelTemplate = {
  template_name: string;
  // 라벨 규격 (mm)
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
  qr_x: number;
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
  // 프린터
  printer_name: string;          // Windows Printer Name
  printer_display_name: string;  // 화면 표시 이름
  printer_model: string;
  printer_max_print_width: number;  // mm
  printer_max_media_width: number;  // mm
  printer_dpi: number;
  printer_connection: "usb" | "network" | "serial";
  bridge_enabled: boolean;
  bridge_url: string;
};

export const QR_LABEL_DEFAULTS: QrLabelTemplate = {
  template_name: QR_LABEL_TEMPLATE_KEY,
  label_width: 30,
  label_height: 20,
  columns: 1,
  horizontal_gap: 2,
  vertical_gap: 2,
  margin_top: 0,
  margin_bottom: 0,
  margin_left: 0,
  margin_right: 0,
  orientation: "portrait",
  dpi: 203,
  qr_x: 8,
  qr_y: 2,
  qr_width: 14,
  qr_height: 14,
  qr_error_level: "M",
  qr_quiet_zone: 1,
  edition_x: 8,
  edition_y: 16.5,
  edition_font_size: 8,
  edition_font_family: "Arial",
  edition_font_weight: "bold",
  edition_alignment: "center",
  printer_name: "QIRUI T300",
  printer_display_name: "Qirui T300",
  printer_model: "Qirui T300 / 启锐 T300",
  printer_max_print_width: 108,
  printer_max_media_width: 118,
  printer_dpi: 203,
  printer_connection: "usb",
  bridge_enabled: true,
  bridge_url: "http://127.0.0.1:9110",
};

export function mergeTemplate(raw: unknown): QrLabelTemplate {
  const v = (raw ?? {}) as Partial<QrLabelTemplate>;
  return { ...QR_LABEL_DEFAULTS, ...v, template_name: QR_LABEL_TEMPLATE_KEY };
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

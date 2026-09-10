import { forwardRef, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { resolveBottomEditionBox, type QrLabelTemplate } from "@/lib/qr-label-template";

/** 스티커 고유번호를 그대로 담은 QR 이미지 (스캔 결과 = 고유번호) */
export const QrImg = forwardRef<HTMLImageElement, {
  value: string; level?: "L" | "M" | "Q" | "H"; className?: string; style?: React.CSSProperties;
}>(({ value, level, className, style }, ref) => {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value || " ", { errorCorrectionLevel: level ?? "M", margin: 0, scale: 8 })
      .then((d) => { if (alive) setSrc(d); })
      .catch(() => { if (alive) setSrc(""); });
    return () => { alive = false; };
  }, [value, level]);
  if (!src) return <div className={className} style={style} />;
  return <img ref={ref} src={src} alt={value} className={className} style={style} draggable={false} />;
});
QrImg.displayName = "QrImg";

type Patch = Partial<QrLabelTemplate>;

/**
 * 실제 mm 좌표계를 그대로 사용하는 WYSIWYG 라벨 캔버스.
 * 화면에서는 `scale`(px/mm)로만 확대하고, 저장값은 항상 mm 이다.
 */
export default function LabelCanvas({
  template, code, edition, scale = 6, editable = false, onChange,
}: {
  template: QrLabelTemplate;
  code: string;
  edition: string;
  scale?: number;
  editable?: boolean;
  onChange?: (patch: Patch) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const t = template;
  const px = (mm: number) => mm * scale;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const round2 = (v: number) => Math.round(v * 100) / 100;

  const startDrag = (
    e: React.PointerEvent,
    mode: "qr" | "edition" | "resize" | "center",
  ) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const s = {
      qx: t.qr_x, qy: t.qr_y, qw: t.qr_width, qh: t.qr_height,
      ex: t.edition_x, ey: t.edition_y,
      cox: t.edition_center_offset_x ?? 0, coy: t.edition_center_offset_y ?? 0,
    };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (mode === "qr") {
        // qr_x/qr_y = QR 중심점 — QR이 라벨 안에 유지되도록 중심 범위를 제한
        onChange({
          qr_x: round2(clamp(s.qx + dx, s.qw / 2, t.label_width - s.qw / 2)),
          qr_y: round2(clamp(s.qy + dy, s.qh / 2, t.label_height - s.qh / 2)),
        });
      } else if (mode === "center") {
        const lim = Math.max(0.5, t.qr_width / 3);
        onChange({
          edition_center_offset_x: round2(clamp(s.cox + dx, -lim, lim)),
          edition_center_offset_y: round2(clamp(s.coy + dy, -lim, lim)),
        });
      } else if (mode === "edition") {
        onChange({
          edition_x: round2(clamp(s.ex + dx, 0, t.label_width)),
          edition_y: round2(clamp(s.ey + dy, 0, t.label_height)),
        });
      } else {
        // 중심 기준 최대 크기 = 중심에서 가장 가까운 라벨 가장자리까지의 2배
        const maxSize = 2 * Math.min(s.qx, t.label_width - s.qx, s.qy, t.label_height - s.qy);
        const size = round2(clamp(Math.max(s.qw + dx, s.qh + dy), 3, Math.max(3, maxSize)));
        onChange({ qr_width: size, qr_height: size });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const bottomBox = resolveBottomEditionBox(t, edition);

  const alignStyle: React.CSSProperties =
    t.edition_alignment === "center"
      ? { transform: "translateX(-50%)" }
      : t.edition_alignment === "right"
        ? { transform: "translateX(-100%)" }
        : {};

  return (
    <div
      ref={ref}
      className="relative bg-white border border-border overflow-hidden select-none"
      style={{
        width: px(t.label_width),
        height: px(t.label_shape === "round" ? t.label_width : t.label_height),
        borderRadius: t.label_shape === "round" ? "50%" : undefined,
      }}
    >
      {t.label_shape === "round" && (
        <div className="pointer-events-none absolute inset-0 rounded-full border border-dashed border-muted-foreground/40" />
      )}
      {/* QR 중심 기준점 — 중심 X/Y 좌표 확인용 십자선 (미리보기 전용, 인쇄되지 않음) */}
      {editable && (
        <div
          className="pointer-events-none absolute"
          style={{ left: px(t.qr_x), top: px(t.qr_y), zIndex: 20 }}
        >
          <div className="absolute bg-red-500" style={{ left: -12, top: -0.5, width: 24, height: 1 }} />
          <div className="absolute bg-red-500" style={{ left: -0.5, top: -12, width: 1, height: 24 }} />
          <div className="absolute rounded-full border border-red-500 bg-white/60" style={{ left: -2, top: -2, width: 4, height: 4 }} />
        </div>
      )}
      {/* QR */}
      <div
        onPointerDown={(e) => startDrag(e, "qr")}
        className={`absolute ${editable ? "cursor-move ring-1 ring-primary/50" : ""}`}
        style={{ left: px(t.qr_x - t.qr_width / 2), top: px(t.qr_y - t.qr_height / 2), width: px(t.qr_width), height: px(t.qr_height) }}
      >
        <QrImg value={code} level={t.qr_error_level} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />
        {editable && (
          <div
            onPointerDown={(e) => startDrag(e, "resize")}
            className="absolute -right-1 -bottom-1 w-3 h-3 rounded-sm bg-primary cursor-nwse-resize"
          />
        )}
      </div>

      {/* Edition Number — QR 아래, 라벨 내부 */}
      {t.edition_placement === "qr_bottom" || t.edition_placement === "qr_center" ? (
        <div
          onPointerDown={(e) => startDrag(e, "center")}
          className={`absolute flex items-center justify-center text-black ${editable ? "cursor-move ring-1 ring-primary/60" : ""}`}
          style={{
            left: px(bottomBox.x), top: px(bottomBox.y),
            width: px(bottomBox.w), height: px(bottomBox.h),
            fontSize: (bottomBox.fontPt * 25.4 / 72) * scale,
            fontFamily: t.edition_font_family,
            fontWeight: t.edition_font_weight === "bold" ? 700 : 400,
            lineHeight: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {edition}
        </div>
      ) : (
      <div
        onPointerDown={(e) => startDrag(e, "edition")}
        className={`absolute whitespace-nowrap text-black ${editable ? "cursor-move ring-1 ring-primary/50" : ""}`}
        style={{
          left: px(t.edition_x),
          top: px(t.edition_y),
          fontSize: (t.edition_font_size * 25.4 / 72) * scale,
          fontFamily: t.edition_font_family,
          fontWeight: t.edition_font_weight === "bold" ? 700 : 400,
          lineHeight: 1,
          ...alignStyle,
        }}
      >
        {edition}
      </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { QrLabelTemplate } from "@/lib/qr-label-template";

/** 스티커 고유번호를 그대로 담은 QR 이미지 (스캔 결과 = 고유번호) */
export function QrImg({ value, level, className, style }: {
  value: string; level?: "L" | "M" | "Q" | "H"; className?: string; style?: React.CSSProperties;
}) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value || " ", { errorCorrectionLevel: level ?? "M", margin: 0, scale: 8 })
      .then((d) => { if (alive) setSrc(d); })
      .catch(() => { if (alive) setSrc(""); });
    return () => { alive = false; };
  }, [value, level]);
  if (!src) return <div className={className} style={style} />;
  return <img src={src} alt={value} className={className} style={style} draggable={false} />;
}

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
    mode: "qr" | "edition" | "resize",
  ) => {
    if (!editable || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const s = { qx: t.qr_x, qy: t.qr_y, qw: t.qr_width, qh: t.qr_height, ex: t.edition_x, ey: t.edition_y };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (mode === "qr") {
        onChange({
          qr_x: round2(clamp(s.qx + dx, 0, t.label_width - s.qw)),
          qr_y: round2(clamp(s.qy + dy, 0, t.label_height - s.qh)),
        });
      } else if (mode === "edition") {
        onChange({
          edition_x: round2(clamp(s.ex + dx, 0, t.label_width)),
          edition_y: round2(clamp(s.ey + dy, 0, t.label_height)),
        });
      } else {
        const size = round2(clamp(Math.max(s.qw + dx, s.qh + dy), 3, Math.min(t.label_width - s.qx, t.label_height - s.qy)));
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
      style={{ width: px(t.label_width), height: px(t.label_height) }}
    >
      {/* QR */}
      <div
        onPointerDown={(e) => startDrag(e, "qr")}
        className={`absolute ${editable ? "cursor-move ring-1 ring-primary/50" : ""}`}
        style={{ left: px(t.qr_x), top: px(t.qr_y), width: px(t.qr_width), height: px(t.qr_height) }}
      >
        <QrImg value={code} level={t.qr_error_level} style={{ width: "100%", height: "100%", imageRendering: "pixelated" }} />
        {editable && (
          <div
            onPointerDown={(e) => startDrag(e, "resize")}
            className="absolute -right-1 -bottom-1 w-3 h-3 rounded-sm bg-primary cursor-nwse-resize"
          />
        )}
      </div>

      {/* Edition Number */}
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
    </div>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Common NFC card geometry. Single source of truth for the
 * 57mm × 87mm frame used across factory previews, the order
 * detail modal, lightbox, and any print preview surface.
 */
export const CARD_W_MM = 57;
export const CARD_H_MM = 87;
export const CARD_ASPECT_RATIO = `${CARD_W_MM}/${CARD_H_MM}`;
/** Tailwind arbitrary aspect-ratio class for the card frame. */
export const CARD_ASPECT_CLASS = `aspect-[${CARD_W_MM}/${CARD_H_MM}]`;

export interface CardFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** When true, the frame renders at real-world mm dimensions (with optional calibration). */
  actualSize?: boolean;
  /** Screen calibration percentage (100 = 1mm CSS = 1mm physical). */
  mmScale?: number;
  /** Override width in CSS units; ignored when `actualSize` is true. */
  widthClassName?: string;
  /** Inner content (image, preview, overlay…). The frame enforces the 57:87 box. */
  children?: React.ReactNode;
}

/**
 * `<CardFrame>` enforces the 57mm × 87mm aspect ratio for any
 * NFC card visualization. Pass `actualSize` to render at true
 * physical millimeter dimensions (great for print/lightbox QA).
 */
export const CardFrame = React.forwardRef<HTMLDivElement, CardFrameProps>(
  ({ actualSize, mmScale = 100, widthClassName, className, style, children, ...rest }, ref) => {
    const k = (mmScale || 100) / 100;
    const realSizeStyle: React.CSSProperties | undefined = actualSize
      ? {
          width: `calc(${CARD_W_MM}mm * ${k})`,
          height: `calc(${CARD_H_MM}mm * ${k})`,
          aspectRatio: "auto",
        }
      : undefined;
    const ratioStyle: React.CSSProperties | undefined = !actualSize
      ? { aspectRatio: `${CARD_W_MM} / ${CARD_H_MM}` }
      : undefined;

    return (
      <div
        ref={ref}
        className={cn(
          "relative overflow-hidden bg-muted/40",
          !actualSize && CARD_ASPECT_CLASS,
          !actualSize && (widthClassName ?? "w-full"),
          className,
        )}
        style={{ ...ratioStyle, ...realSizeStyle, ...style }}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
CardFrame.displayName = "CardFrame";

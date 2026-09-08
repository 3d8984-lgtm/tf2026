import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { buildFinalLabelRaster, labelPageSizePt, type AgentLabelItem } from "@/lib/agent-label-print";
import type { FinalLabelRaster } from "@/lib/final-label-raster";
import type { QrLabelTemplate } from "@/lib/qr-label-template";

export default function FinalPrintPreviewDialog({
  open, onOpenChange, template, items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: QrLabelTemplate;
  items: AgentLabelItem[];
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);
  const [raster, setRaster] = useState<FinalLabelRaster | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const size = labelPageSizePt(template, Math.max(1, items.length));

  useEffect(() => {
    if (!open || items.length === 0) return;
    let active = true;
    setRaster(null);
    setImageUrl("");
    setError("");
    let objectUrl = "";
    void buildFinalLabelRaster(template, items)
      .then((result) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(result.png);
        setRaster(result);
        setImageUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (active) setError(String((cause as Error)?.message ?? cause));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, template, items]);

  const downloadPng = () => {
    if (!raster) return;
    const url = URL.createObjectURL(raster.png);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `final-print-${raster.widthMm}x${raster.heightMm}mm-${raster.dpi}dpi.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] grid-rows-[auto_auto_1fr]">
        <DialogHeader>
          <DialogTitle>{tr("최종 인쇄 이미지 확인", "确认最终打印图像")}</DialogTitle>
          <DialogDescription>
            {tr("Print Agent로 보내는 데이터와 동일한 최종 PNG입니다.", "这是与发送到打印代理的数据相同的最终 PNG。")}{" "}
            {size.wMm}×{size.hMm}mm · {size.cols}{tr("열", "列")} · {size.rows}{tr("행", "行")} · {items.length}{tr("개", "个")}
          </DialogDescription>
        </DialogHeader>
        {raster && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs tabular-nums sm:grid-cols-5">
              <span>Physical Width <b>{raster.widthMm} mm</b></span>
              <span>Physical Height <b>{raster.heightMm} mm</b></span>
              <span>Pixel Width <b>{raster.pixelWidth} px</b></span>
              <span>Pixel Height <b>{raster.pixelHeight} px</b></span>
              <span>DPI <b>{raster.dpi}</b></span>
              <span className="col-span-2 sm:col-span-5">SHA-256 <b className="font-mono break-all">{raster.sha256}</b></span>
              <span>Columns <b>{size.cols}</b></span>
              <span>Rows <b>{size.rows}</b></span>
              <span>Label <b>{size.cellW}×{size.cellH} mm</b></span>
              <span>Horizontal Pitch <b>{size.horizontalPitchMm} mm</b></span>
              <span>Vertical Pitch <b>{size.verticalPitchMm} mm</b></span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" className="gap-1" onClick={downloadPng}>
                <Download className="h-4 w-4" />{tr("동일 PNG 다운로드", "下载相同 PNG")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {tr("다운로드와 RAW 출력은 이 PNG 바이너리를 그대로 사용합니다.", "下载与 RAW 打印直接使用此 PNG 二进制文件。")}
              </p>
            </div>
          </div>
        )}
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : raster && imageUrl ? (
          <div className="min-h-0 overflow-auto rounded-md border bg-muted/30 p-3">
            <img src={imageUrl} alt={tr("최종 인쇄 래스터 이미지", "最终打印栅格图像")} className="mx-auto h-auto max-w-full bg-background shadow-sm" />
          </div>
        ) : (
          <div className="flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
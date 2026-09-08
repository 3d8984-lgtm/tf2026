import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { buildLabelsPdf, labelPageSizePt, type AgentLabelItem } from "@/lib/agent-label-print";
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
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const size = labelPageSizePt(template, Math.max(1, items.length));

  useEffect(() => {
    if (!open || items.length === 0) return;
    let active = true;
    let objectUrl = "";
    setUrl("");
    setError("");
    void buildLabelsPdf(template, items)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) => {
        if (active) setError(String((cause as Error)?.message ?? cause));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, template, items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] grid-rows-[auto_1fr]">
        <DialogHeader>
          <DialogTitle>{tr("최종 인쇄 미리보기", "最终打印预览")}</DialogTitle>
          <DialogDescription>
            {tr("실제 프린터로 전달되는 PDF입니다.", "这是实际发送到打印机的 PDF。")}{" "}
            {size.wMm}×{size.hMm}mm · {size.cols}{tr("열", "列")} · {size.rows}{tr("행", "行")} · {items.length}{tr("개", "个")}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : url ? (
          <iframe title={tr("최종 인쇄 PDF", "最终打印 PDF")} src={url} className="w-full h-full border rounded-md bg-muted" />
        ) : (
          <div className="flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        )}
      </DialogContent>
    </Dialog>
  );
}
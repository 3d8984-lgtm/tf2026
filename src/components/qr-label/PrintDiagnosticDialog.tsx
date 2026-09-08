import { useEffect, useState } from "react";
import { Download, Eye, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import {
  buildDiagnosticPdf, labelPageSizePt, printDiagnosticViaAgent, type DiagnosticMode,
} from "@/lib/agent-label-print";
import type { QrLabelTemplate } from "@/lib/qr-label-template";
import { friendlyAgentError } from "@/lib/print-agent";
import { toast } from "sonner";
import PdfBlobPreview from "./PdfBlobPreview";

const MODES: DiagnosticMode[] = ["cross", "square", "qr"];

export default function PrintDiagnosticDialog({
  open, onOpenChange, template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: QrLabelTemplate;
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);
  const [mode, setMode] = useState<DiagnosticMode>("cross");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const diagnosticTemplate = { ...template, columns: 5 };
  const size = labelPageSizePt(diagnosticTemplate, 50);
  const label = (value: DiagnosticMode) => value === "cross"
    ? tr("1. 중앙 +", "1. 中心 +")
    : value === "square" ? tr("2. 6mm 사각형", "2. 6mm 方块") : tr("3. QR", "3. 二维码");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setBlob(null);
    void buildDiagnosticPdf(diagnosticTemplate, mode).then((nextBlob) => {
      if (!active) return;
      setBlob(nextBlob);
    });
    return () => {
      active = false;
    };
  }, [open, mode, template]);

  const download = async () => {
    const blob = await buildDiagnosticPdf(diagnosticTemplate, mode);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `qr-label-diagnostic-${mode}.pdf`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  const print = async () => {
    setBusy(true);
    try {
      await printDiagnosticViaAgent(diagnosticTemplate, mode);
      toast.success(tr(`${label(mode)} 테스트를 프린터로 전송했습니다.`, `${label(mode)} 测试已发送到打印机。`));
    } catch (cause: unknown) {
      toast.error(friendlyAgentError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] grid-rows-[auto_1fr]">
        <DialogHeader>
          <DialogTitle>{tr("좌표 진단 출력", "坐标诊断打印")}</DialogTitle>
          <DialogDescription>
            {tr("+ → 사각형 → QR 순서로 각각 출력해 원인을 분리합니다.", "请按 + → 方块 → 二维码的顺序分别打印以定位原因。")}{" "}
            {size.wMm}×{size.hMm}mm · 5{tr("열", "列")}×10{tr("행", "行")}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(value) => setMode(value as DiagnosticMode)} className="min-h-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="grid grid-cols-3">
              {MODES.map((value) => <TabsTrigger key={value} value={value}>{label(value)}</TabsTrigger>)}
            </TabsList>
            <Button variant="outline" size="sm" className="gap-1 ml-auto" onClick={() => void download()}>
              <Download className="w-4 h-4" />{tr("PDF 다운로드", "下载 PDF")}
            </Button>
            <Button size="sm" className="gap-1" onClick={() => void print()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {tr("현재 단계 출력", "打印当前步骤")}
            </Button>
          </div>
          {MODES.map((value) => (
            <TabsContent key={value} value={value} className="mt-0 min-h-0 flex-1">
              {blob ? <PdfBlobPreview blob={blob} /> : (
                <div className="h-full flex items-center justify-center text-muted-foreground"><Eye className="w-5 h-5" /></div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
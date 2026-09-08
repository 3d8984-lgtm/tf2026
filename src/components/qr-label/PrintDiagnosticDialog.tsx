import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/contexts/LangContext";
import { buildFinalDiagnosticRaster, labelPageSizePt, printDiagnosticViaAgent, type DiagnosticMode } from "@/lib/agent-label-print";
import type { FinalLabelRaster } from "@/lib/final-label-raster";
import type { QrLabelTemplate } from "@/lib/qr-label-template";
import { friendlyAgentError, getPrintAgentCapabilities, type PrintAgentCapabilities, type RawPngPrintResult } from "@/lib/print-agent";
import { toast } from "sonner";

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
  const [raster, setRaster] = useState<FinalLabelRaster | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [capabilities, setCapabilities] = useState<PrintAgentCapabilities | null>(null);
  const [result, setResult] = useState<RawPngPrintResult | null>(null);
  const [busy, setBusy] = useState(false);
  const diagnosticTemplate = { ...template, columns: 5 };
  const size = labelPageSizePt(diagnosticTemplate, 50);
  const label = (value: DiagnosticMode) => value === "cross"
    ? tr("1. 중앙 +", "1. 中心 +")
    : value === "square" ? tr("2. 6mm 사각형", "2. 6mm 方块") : tr("3. QR", "3. 二维码");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setRaster(null);
    setResult(null);
    let objectUrl = "";
    void buildFinalDiagnosticRaster(diagnosticTemplate, mode).then((nextRaster) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(nextRaster.png);
      setRaster(nextRaster);
      setImageUrl(objectUrl);
    });
    void getPrintAgentCapabilities().then((value) => { if (active) setCapabilities(value); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, mode, template]);

  const download = async () => {
    if (!raster) return;
    const objectUrl = URL.createObjectURL(raster.png);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `qr-label-diagnostic-${mode}-${raster.sha256.slice(0, 12)}.png`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  const print = async () => {
    setBusy(true);
    try {
      const nextResult = await printDiagnosticViaAgent(diagnosticTemplate, mode);
      setResult(nextResult);
      toast.success(nextResult.verified
        ? tr("Agent 수신 해시와 픽셀 크기가 일치했습니다.", "代理接收的哈希和像素尺寸一致。")
        : tr("전송했지만 Agent의 수신 무결성은 확인되지 않았습니다.", "已发送，但无法验证代理接收完整性。"));
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
            <Button variant="outline" size="sm" className="gap-1 ml-auto" onClick={() => void download()} disabled={!raster}>
              <Download className="w-4 h-4" />{tr("동일 PNG 다운로드", "下载相同 PNG")}
            </Button>
            <Button size="sm" className="gap-1" onClick={() => void print()} disabled={busy || !raster || !capabilities?.rawPng}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {tr("RAW 1:1 출력", "RAW 1:1 打印")}
            </Button>
          </div>
          <div className="grid gap-1 text-xs tabular-nums sm:grid-cols-2">
            <span>Master <b>{raster ? `${raster.pixelWidth}×${raster.pixelHeight}px · ${raster.dpi} DPI` : "—"}</b></span>
            <span>SHA-256 <b className="font-mono break-all">{raster?.sha256 ?? "—"}</b></span>
            <span>Agent <b>{capabilities?.online ? `${capabilities.version ?? tr("버전 미제공", "未提供版本")} · ${capabilities.rawPng ? "RAW PNG" : tr("업데이트 필요", "需要更新")}` : tr("연결 안 됨", "未连接")}</b></span>
            <span>Driver DPI <b>{capabilities?.driver?.dpiX ?? "—"} × {capabilities?.driver?.dpiY ?? "—"}</b></span>
            <span>Printable px <b>{capabilities?.driver?.printableWidthPx ?? "—"} × {capabilities?.driver?.printableHeightPx ?? "—"}</b></span>
            <span>Physical offset px <b>{capabilities?.driver?.physicalOffsetXPx ?? "—"}, {capabilities?.driver?.physicalOffsetYPx ?? "—"}</b></span>
            {result && <span className="sm:col-span-2">Agent Received <b>{result.receivedPixelWidth ?? "—"}×{result.receivedPixelHeight ?? "—"}px · {result.verified ? tr("해시 일치", "哈希一致") : tr("검증 불가", "无法验证")}</b></span>}
          </div>
          {capabilities?.online && !capabilities.rawPng && (
            <p className="text-xs text-destructive">{tr("현재 Agent는 동일 PNG 검증 및 RAW 1:1 출력을 지원하지 않습니다. Agent 업데이트 전에는 실제 출력 일치 여부를 증명할 수 없습니다.", "当前代理不支持相同 PNG 验证和 RAW 1:1 打印，更新前无法证明实际打印一致。")}</p>
          )}
          {MODES.map((value) => (
            <TabsContent key={value} value={value} className="mt-0 min-h-0 flex-1">
              {raster && imageUrl ? <div className="h-full overflow-auto rounded-md border bg-muted/30 p-3"><img src={imageUrl} alt={label(value)} className="mx-auto h-auto max-w-full bg-background" /></div> : <div className="h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
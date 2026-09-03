import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import LabelCanvas from "./LabelCanvas";
import { checkWidth, type QrLabelTemplate } from "@/lib/qr-label-template";
import { bridgeHealth, bridgePrinters, type BridgePrinter } from "@/lib/print-bridge";
import { useLang } from "@/contexts/LangContext";

type NumKey = keyof QrLabelTemplate;

export default function QrLabelSettingsDialog({
  open, onOpenChange, template, onSave, sampleCode, sampleEdition,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: QrLabelTemplate;
  onSave: (t: QrLabelTemplate) => Promise<void>;
  sampleCode: string;
  sampleEdition: string;
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);

  const [draft, setDraft] = useState<QrLabelTemplate>(template);
  const [saving, setSaving] = useState(false);
  const [scale, setScale] = useState(10);
  const [printers, setPrinters] = useState<BridgePrinter[]>([]);
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => { if (open) setDraft(template); }, [open, template]);

  const set = (patch: Partial<QrLabelTemplate>) => setDraft((p) => ({ ...p, ...patch }));
  const num = (key: NumKey, label: string, step = 0.5, min = 0) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number" step={step} min={min}
        value={String(draft[key] ?? "")}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<QrLabelTemplate>)}
        className="h-8"
      />
    </div>
  );

  const probeBridge = async () => {
    setProbing(true);
    const up = await bridgeHealth(draft.bridge_url);
    setBridgeUp(up);
    setPrinters(up ? await bridgePrinters(draft.bridge_url) : []);
    setProbing(false);
  };
  useEffect(() => { if (open) void probeBridge(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const width = checkWidth(draft);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(tr("라벨 설정을 저장했습니다", "标签设置已保存"));
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? tr("저장 실패", "保存失败"));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{tr("QR 라벨 설정", "二维码标签设置")}</DialogTitle>
          <DialogDescription>
            {tr("모든 값은 mm 기준으로 서버에 저장되어 모든 PC에 동일하게 적용됩니다.",
                "所有数值以 mm 保存到服务器，所有电脑共用同一设置。")}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="spec">
          <TabsList className="grid grid-cols-4">
            <TabsTrigger value="spec">{tr("라벨 규격", "标签规格")}</TabsTrigger>
            <TabsTrigger value="qr">QR CODE</TabsTrigger>
            <TabsTrigger value="edition">Edition</TabsTrigger>
            <TabsTrigger value="printer">{tr("프린터", "打印机")}</TabsTrigger>
          </TabsList>

          <div className="grid gap-6 md:grid-cols-[1fr_auto] mt-4">
            <div>
              <TabsContent value="spec" className="mt-0 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {num("label_width", tr("라벨 가로(mm)", "标签宽(mm)"))}
                {num("label_height", tr("라벨 세로(mm)", "标签高(mm)"))}
                {num("columns", tr("열 개수", "列数"), 1, 1)}
                {num("horizontal_gap", tr("가로 간격(mm)", "横向间距(mm)"))}
                {num("vertical_gap", tr("세로 간격(mm)", "纵向间距(mm)"))}
                {num("margin_left", tr("좌측 여백(mm)", "左边距(mm)"))}
                {num("margin_right", tr("우측 여백(mm)", "右边距(mm)"))}
                {num("margin_top", tr("상단 여백(mm)", "上边距(mm)"))}
                {num("margin_bottom", tr("하단 여백(mm)", "下边距(mm)"))}
                <div className="space-y-1">
                  <Label className="text-xs">{tr("출력 방향", "打印方向")}</Label>
                  <Select value={draft.orientation} onValueChange={(v) => set({ orientation: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">{tr("세로", "纵向")}</SelectItem>
                      <SelectItem value="landscape">{tr("가로", "横向")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {num("dpi", "DPI", 1, 1)}
              </TabsContent>

              <TabsContent value="qr" className="mt-0 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {num("qr_x", "X (mm)", 0.1)}
                {num("qr_y", "Y (mm)", 0.1)}
                {num("qr_width", "Width (mm)", 0.1)}
                {num("qr_height", "Height (mm)", 0.1)}
                <div className="space-y-1">
                  <Label className="text-xs">Error Correction</Label>
                  <Select value={draft.qr_error_level} onValueChange={(v) => set({ qr_error_level: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["L", "M", "Q", "H"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {num("qr_quiet_zone", "Quiet Zone (mm)", 0.1)}
                <p className="col-span-full text-xs text-muted-foreground">
                  {tr("미리보기에서 QR을 드래그해 이동하고, 우하단 모서리를 끌어 크기를 조절할 수 있습니다.",
                      "可在预览中拖动二维码移动，拖右下角调整大小。")}
                </p>
              </TabsContent>

              <TabsContent value="edition" className="mt-0 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {num("edition_x", "X (mm)", 0.1)}
                {num("edition_y", "Y (mm)", 0.1)}
                {num("edition_font_size", tr("글자 크기(pt)", "字号(pt)"), 0.5, 1)}
                <div className="space-y-1">
                  <Label className="text-xs">{tr("폰트", "字体")}</Label>
                  <Select value={draft.edition_font_family} onValueChange={(v) => set({ edition_font_family: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Arial", "Helvetica", "Courier New", "Verdana", "Tahoma"].map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tr("굵기", "字重")}</Label>
                  <Select value={draft.edition_font_weight} onValueChange={(v) => set({ edition_font_weight: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="bold">Bold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tr("정렬", "对齐")}</Label>
                  <Select value={draft.edition_alignment} onValueChange={(v) => set({ edition_alignment: v as any })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="printer" className="mt-0 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  {bridgeUp === null || probing ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : bridgeUp ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  )}
                  <span>Local Print Bridge · {bridgeUp ? tr("실행 중", "运行中") : tr("연결되지 않음", "未连接")}</span>
                  <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void probeBridge()}>
                    <RefreshCw className="w-3.5 h-3.5" />{tr("다시 확인", "重新检测")}
                  </Button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-1 col-span-full sm:col-span-1">
                    <Label className="text-xs">{tr("표시 이름", "显示名称")}</Label>
                    <Input className="h-8" value={draft.printer_display_name}
                      onChange={(e) => set({ printer_display_name: e.target.value })} />
                  </div>
                  <div className="space-y-1 col-span-full sm:col-span-2">
                    <Label className="text-xs">Windows Printer Name</Label>
                    {printers.length > 0 ? (
                      <Select value={draft.printer_name} onValueChange={(v) => set({ printer_name: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {printers.map((p) => (
                            <SelectItem key={p.name} value={p.name}>
                              {p.name}{p.isDefault ? ` · ${tr("기본", "默认")}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input className="h-8" value={draft.printer_name}
                        onChange={(e) => set({ printer_name: e.target.value })} />
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Printer Model</Label>
                    <Input className="h-8" value={draft.printer_model}
                      onChange={(e) => set({ printer_model: e.target.value })} />
                  </div>
                  {num("printer_max_print_width", tr("최대 인쇄폭(mm)", "最大打印宽(mm)"), 1, 1)}
                  {num("printer_max_media_width", tr("최대 용지폭(mm)", "最大纸宽(mm)"), 1, 1)}
                  {num("printer_dpi", tr("프린터 DPI", "打印机DPI"), 1, 1)}
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("통신 방식", "通信方式")}</Label>
                    <Select value={draft.printer_connection} onValueChange={(v) => set({ printer_connection: v as any })}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usb">USB</SelectItem>
                        <SelectItem value="network">Network</SelectItem>
                        <SelectItem value="serial">Serial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 col-span-full sm:col-span-2">
                    <Label className="text-xs">Local Print Bridge URL</Label>
                    <Input className="h-8" value={draft.bridge_url}
                      onChange={(e) => set({ bridge_url: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Switch checked={draft.bridge_enabled} onCheckedChange={(v) => set({ bridge_enabled: v })} />
                    <span className="text-xs">{tr("Local Print Bridge 사용", "使用 Local Print Bridge")}</span>
                  </div>
                </div>
              </TabsContent>
            </div>

            {/* WYSIWYG 미리보기 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {draft.label_width} × {draft.label_height} mm
                </span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setScale((s) => Math.max(4, s - 2))}>−</Button>
                  <span className="text-xs tabular-nums w-8 text-center">{scale}×</span>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setScale((s) => Math.min(24, s + 2))}>+</Button>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 inline-block">
                <LabelCanvas
                  template={draft} code={sampleCode} edition={sampleEdition}
                  scale={scale} editable onChange={(p) => set(p)}
                />
              </div>
              <div className={`text-xs rounded-md px-2 py-1.5 ${width.ok ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"}`}>
                {tr("필요 출력폭", "所需打印宽")} {width.requiredMm}mm / {tr("최대", "最大")} {width.maxMm}mm
                {width.ok ? ` · ${tr("출력 가능", "可打印")}` : ` · ${tr("출력폭 초과", "超出打印宽度")}`}
              </div>
            </div>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{tr("취소", "取消")}</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{tr("설정 저장", "保存设置")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

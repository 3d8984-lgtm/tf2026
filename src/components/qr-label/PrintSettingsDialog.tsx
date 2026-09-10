import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { resolveMediaLayout, type QrLabelTemplate } from "@/lib/qr-label-template";
import { useLang } from "@/contexts/LangContext";

export default function PrintSettingsDialog({
  open, onOpenChange, template, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: QrLabelTemplate;
  onSave: (t: QrLabelTemplate) => Promise<void>;
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);

  const [draft, setDraft] = useState<QrLabelTemplate>(template);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setDraft(template); }, [open, template]);

  const set = (patch: Partial<QrLabelTemplate>) => setDraft((p) => ({ ...p, ...patch }));

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(tr("인쇄 설정을 저장했습니다", "打印设置已保存"));
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? tr("저장 실패", "保存失败"));
    } finally { setSaving(false); }
  };

  const media = resolveMediaLayout(draft);
  const total = Math.max(0, Number(draft.test_before_count) || 0) + Math.max(0, Number(draft.test_after_count) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tr("인쇄 설정", "打印设置")}</DialogTitle>
          <DialogDescription>
            {tr("서버에 저장되어 모든 PC에 동일하게 적용됩니다.", "保存到服务器，所有电脑共用同一设置。")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-start gap-2">
            <Checkbox
              id="reverse-print"
              checked={draft.reverse_print}
              onCheckedChange={(v) => set({ reverse_print: v === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="reverse-print" className="text-sm">
                {tr("전체 인쇄 시 역순으로 인쇄", "整单打印时倒序打印")}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {tr("마지막 번호부터 출력해 배출 순서가 1번부터가 되도록 합니다.",
                    "从最后一个编号开始打印，使出纸顺序从第 1 张开始。")}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="direct-pdf-print"
              checked={draft.direct_pdf_print !== false}
              onCheckedChange={(v) => set({ direct_pdf_print: v === true })}
            />
            <div className="space-y-0.5">
              <Label htmlFor="direct-pdf-print" className="text-sm">
                {tr("변환 없이 바로 보내기", "不转换直接发送")}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {tr("만든 라벨 문서를 이미지로 다시 굽지 않고 그대로 프린터로 보냅니다(초기 방식). 끄면 이미지로 변환해 보냅니다.",
                    "将生成的标签文件直接发送到打印机，不再转成图片（初期方式）。关闭则转换成图片后发送。")}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{tr("시험 인쇄", "试打印")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{tr("본 인쇄 앞 (매)", "正式打印前（张）")}</Label>
                <Input type="number" min={0} step={1} className="h-8"
                  value={String(draft.test_before_count ?? 0)}
                  onChange={(e) => set({ test_before_count: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("본 인쇄 뒤 (매)", "正式打印后（张）")}</Label>
                <Input type="number" min={0} step={1} className="h-8"
                  value={String(draft.test_after_count ?? 0)}
                  onChange={(e) => set({ test_after_count: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("시험 라벨 QR 내용", "试打标签二维码内容")}</Label>
                <Input className="h-8" value={draft.test_label_code}
                  onChange={(e) => set({ test_label_code: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("시험 라벨 표시 문구", "试打标签显示文字")}</Label>
                <Input className="h-8" value={draft.test_label_text}
                  onChange={(e) => set({ test_label_text: e.target.value })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {tr(`전체 인쇄 1회당 시험 라벨 ${total}장이 추가로 출력됩니다. 시험 라벨은 인쇄 기록에 남지 않습니다.`,
                  `每次整单打印将额外输出 ${total} 张试打标签，试打标签不计入打印记录。`)}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{tr("용지 기준 자동 오프셋", "按纸张自动偏移")}</p>
            <div className="flex items-start gap-2">
              <Checkbox
                id="media-auto"
                checked={draft.media_auto_offset}
                onCheckedChange={(v) => set({ media_auto_offset: v === true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="media-auto" className="text-sm">
                  {tr("용지 너비로 좌우 여백·칸 간격 자동 계산", "按纸张宽度自动计算左右边距与间距")}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {tr("용지 전체 너비, 열 개수, 라벨 크기, 다이컷 마진으로 계산해 인쇄물을 용지 정중앙에 배치합니다.",
                      "根据纸张总宽、列数、标签尺寸与模切边距计算，并将打印内容居中于纸张。")}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{tr("용지 전체 너비 (mm)", "纸张总宽（mm）")}</Label>
                <Input type="number" step={0.1} min={0} className="h-8"
                  value={String(draft.media_width ?? 0)}
                  onChange={(e) => set({ media_width: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("다이컷 마진 (mm, 좌우 각각)", "模切边距（mm，左右各）")}</Label>
                <Input type="number" step={0.1} min={0} className="h-8"
                  value={String(draft.die_cut_margin ?? 0)}
                  onChange={(e) => set({ die_cut_margin: Math.max(0, Number(e.target.value) || 0) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("열 개수", "列数")}</Label>
                <Input type="number" step={1} min={1} className="h-8"
                  value={String(draft.columns ?? 1)}
                  onChange={(e) => set({ columns: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("라벨 가로 (mm)", "标签宽度（mm）")}</Label>
                <Input type="number" step={0.1} min={1} className="h-8"
                  value={String(draft.label_width ?? 0)}
                  onChange={(e) => set({ label_width: Math.max(1, Number(e.target.value) || 1) })} />
              </div>
            </div>
            <div className="rounded-md border p-2 text-[11px] space-y-0.5">
              <p>{tr("인쇄 폭", "打印宽度")}: {media.pageWidthMm}mm · {tr("라벨 차지 폭", "标签占宽")}: {media.usedWidthMm}mm</p>
              <p>{tr("좌 여백", "左边距")}: {media.marginLeftMm}mm · {tr("우 여백", "右边距")}: {media.marginRightMm}mm · {tr("칸 간격", "间距")}: {media.horizontalGapMm}mm</p>
              {!media.fits && (
                <p className="text-destructive">
                  {tr("라벨이 용지 폭을 넘습니다. 열 개수나 다이컷 마진을 확인하세요.",
                      "标签超出纸张宽度，请检查列数或模切边距。")}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">{tr("인쇄 위치 보정", "打印位置校正")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{tr("가로 이동 (mm, +오른쪽)", "水平移动（mm，+向右）")}</Label>
                <Input type="number" step={0.1} className="h-8"
                  value={String(draft.print_offset_x ?? 0)}
                  onChange={(e) => set({ print_offset_x: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("세로 이동 (mm, +아래)", "垂直移动（mm，+向下）")}</Label>
                <Input type="number" step={0.1} className="h-8"
                  value={String(draft.print_offset_y ?? 0)}
                  onChange={(e) => set({ print_offset_y: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("가로 배율 (%)", "水平比例（%）")}</Label>
                <Input type="number" step={0.1} min={50} max={200} className="h-8"
                  value={String(draft.print_scale_x ?? 100)}
                  onChange={(e) => set({ print_scale_x: Number(e.target.value) || 100 })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr("세로 배율 (%)", "垂直比例（%）")}</Label>
                <Input type="number" step={0.1} min={50} max={200} className="h-8"
                  value={String(draft.print_scale_y ?? 100)}
                  onChange={(e) => set({ print_scale_y: Number(e.target.value) || 100 })} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {tr("좌표 진단 출력의 + 가 라벨 중앙에서 벗어난 거리만큼 반대 방향으로 이동값을 넣습니다. 왼쪽 칸과 오른쪽 칸의 어긋남이 다르면 가로 배율을 조정합니다.",
                  "根据坐标诊断打印中 + 偏离标签中心的距离，反方向填入移动值。若左右两端偏差不同，请调整水平比例。")}
            </p>
          </div>
        </div>


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

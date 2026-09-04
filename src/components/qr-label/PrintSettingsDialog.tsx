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
import type { QrLabelTemplate } from "@/lib/qr-label-template";
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

  const total = Math.max(0, Number(draft.test_before_count) || 0) + Math.max(0, Number(draft.test_after_count) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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

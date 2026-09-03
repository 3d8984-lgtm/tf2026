import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LabelCanvas from "./LabelCanvas";
import { checkWidth, type QrLabelTemplate } from "@/lib/qr-label-template";
import { useLang } from "@/contexts/LangContext";

export type LabelItem = { position: number; code: string; edition: string };

/** 실제 출력 순서(position ASC)와 동일한 배열로 보여주는 전체 미리보기 */
export default function QrLabelPreviewDialog({
  open, onOpenChange, template, items, limit = 40,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: QrLabelTemplate;
  items: LabelItem[];
  limit?: number;
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);
  const width = checkWidth(template);
  const shown = items.slice(0, limit);
  const scale = 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{tr("라벨 미리보기", "标签预览")}</DialogTitle>
          <DialogDescription>
            {template.label_width}×{template.label_height}mm · {template.columns}
            {tr("열", "列")} · {tr("간격", "间距")} {template.horizontal_gap}mm ·{" "}
            {tr("필요 출력폭", "所需打印宽")} {width.requiredMm}mm / {tr("최대", "最大")} {width.maxMm}mm
          </DialogDescription>
        </DialogHeader>

        {!width.ok && (
          <div className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
            {tr(
              `현재 라벨 배열 폭은 ${width.requiredMm}mm입니다. 선택된 프린터의 최대 인쇄폭은 ${width.maxMm}mm입니다. 현재 설정으로는 출력할 수 없습니다. 열 개수 또는 라벨 크기를 수정하십시오.`,
              `当前标签排列宽度为 ${width.requiredMm}mm，所选打印机最大打印宽度为 ${width.maxMm}mm，无法打印。请修改列数或标签尺寸。`,
            )}
          </div>
        )}

        <div
          className="grid bg-muted/30 p-3 rounded-lg overflow-auto"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, template.columns)}, max-content)`,
            columnGap: template.horizontal_gap * scale,
            rowGap: template.vertical_gap * scale,
            paddingLeft: template.margin_left * scale + 12,
            paddingRight: template.margin_right * scale + 12,
            paddingTop: template.margin_top * scale + 12,
            paddingBottom: template.margin_bottom * scale + 12,
            justifyContent: "start",
          }}
        >
          {shown.map((it) => (
            <div key={it.position} className="relative">
              <LabelCanvas template={template} code={it.code} edition={it.edition} scale={scale} />
              <span className="absolute -top-2 -left-1 text-[9px] bg-background border rounded px-1 tabular-nums">
                {it.position}
              </span>
            </div>
          ))}
        </div>

        {items.length > shown.length && (
          <p className="text-xs text-muted-foreground">
            {tr(`전체 ${items.length}장 중 앞 ${shown.length}장만 표시합니다.`, `共 ${items.length} 张，仅显示前 ${shown.length} 张。`)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

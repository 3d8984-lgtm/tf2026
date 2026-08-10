import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, RotateCcw, Video, ScanLine, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  rowId: string;
  orderId: string | null;
  externalOrderId: string | null;
  itemNo: string | null;
  seq: number | null;
  detail: string;
  isKo: boolean;
  canEdit: boolean;
}

/**
 * Inspector review panel: watch the recorded work videos, check the scan
 * results, then either confirm the item (moves to 처리 완료) or send it back
 * to rework so the T-shirt attachment station has to redo it.
 */
export default function DefectReviewPanel({
  rowId, orderId, externalOrderId, itemNo, seq, detail, isKo, canEdit,
}: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [videoIndex, setVideoIndex] = useState(0);

  const { data: workItem } = useQuery({
    queryKey: ["defect_work_item", orderId, seq],
    enabled: !!orderId && seq != null,
    queryFn: async () => {
      const { data } = await supabase
        .from("tshirt_work_items")
        .select("*")
        .eq("order_id", orderId!)
        .eq("seq", seq!)
        .maybeSingle();
      return data;
    },
  });

  const { data: videos } = useQuery({
    queryKey: ["defect_videos", externalOrderId, itemNo],
    enabled: !!externalOrderId && !!itemNo,
    queryFn: async () => {
      const { data } = await supabase.storage.from("work-videos").list(externalOrderId!, { limit: 1000 });
      const files = (data ?? []).filter(f => {
        const base = f.name.replace(/\.[^.]+$/, "");
        return base.split("__")[0] === itemNo;
      }).sort((a, b) => a.name.localeCompare(b.name));
      const signed = await Promise.all(files.map(async f => {
        const path = `${externalOrderId}/${f.name}`;
        const { data: s } = await supabase.storage.from("work-videos").createSignedUrl(path, 60 * 60);
        return { name: f.name.replace(/\.[^.]+$/, ""), url: s?.signedUrl ?? "" };
      }));
      return signed.filter(s => s.url);
    },
  });

  const scanned: string[] = Array.isArray(workItem?.scanned_values)
    ? (workItem!.scanned_values as unknown as string[])
    : [];
  const stepLabels = isKo
    ? ["마크", "티셔츠", "디자인", "스티커"]
    : ["标记", "T恤", "设计", "贴纸"];

  const confirmDone = useCallback(async () => {
    setBusy(true);
    const { error } = await supabase.from("defect_logs")
      .update({ status: "rework_done", resolved_at: new Date().toISOString() })
      .eq("id", rowId);
    setBusy(false);
    if (error) {
      toast({ title: isKo ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
    toast({ title: isKo ? "처리 완료로 이동" : "已转为处理完成" });
  }, [rowId, isKo, queryClient]);

  const sendToRework = useCallback(async () => {
    if (!orderId || seq == null) {
      toast({ title: isKo ? "작업건 정보 없음" : "无作业信息", variant: "destructive" });
      return;
    }
    setBusy(true);
    const prevCount = (workItem?.rework_count as number | null) ?? 0;
    const { error: wErr } = await supabase.from("tshirt_work_items").upsert({
      order_id: orderId,
      seq,
      item_no: itemNo,
      status: "pending",
      scanned_values: [],
      fail_reason: null,
      completed_at: null,
      rework_reason: detail,
      reworked_at: new Date().toISOString(),
      rework_count: prevCount + 1,
    }, { onConflict: "order_id,seq" });
    if (wErr) {
      setBusy(false);
      toast({ title: isKo ? "재작업 전환 실패" : "返工转换失败", description: wErr.message, variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("defect_logs")
      .update({ status: "rework_queued", restart_stage: "tshirt", resolved_at: null })
      .eq("id", rowId);
    setBusy(false);
    if (error) {
      toast({ title: isKo ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
    queryClient.invalidateQueries({ queryKey: ["tshirt_work_items"] });
    queryClient.invalidateQueries({ queryKey: ["defect_work_item", orderId, seq] });
    toast({ title: isKo ? "재작업으로 전환됨" : "已转为返工" });
  }, [orderId, seq, itemNo, detail, workItem, rowId, isKo, queryClient]);

  const current = videos?.[videoIndex];

  return (
    <div className="mt-4 pt-4 border-t space-y-4">
      <div className="grid grid-cols-2 gap-6">
        {/* Video */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Video className="w-3.5 h-3.5" /> {isKo ? "작업 영상" : "作业视频"}
          </p>
          {current ? (
            <>
              <video key={current.url} src={current.url} controls className="w-full rounded-md bg-black aspect-video" />
              {videos!.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {videos!.map((v, i) => (
                    <button key={v.name} onClick={() => setVideoIndex(i)}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${i === videoIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                      {isKo ? `촬영 ${i + 1}` : `录制 ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-md border border-dashed aspect-video flex items-center justify-center text-xs text-muted-foreground">
              {isKo ? "저장된 영상 없음" : "无视频记录"}
            </div>
          )}
        </div>

        {/* Scan results */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ScanLine className="w-3.5 h-3.5" /> {isKo ? "스캔 결과" : "扫描结果"}
          </p>
          <div className="space-y-1">
            {stepLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <span className="w-14 text-xs text-muted-foreground">{label}</span>
                <span className="font-mono text-xs truncate">{scanned[i] || "-"}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground pt-2 space-y-1">
            <p>{isKo ? "작업건" : "作业项"}: {itemNo ?? "-"}</p>
            <p>{isKo ? "현재 상태" : "当前状态"}: {(workItem?.status as string) ?? "-"}</p>
            {workItem?.fail_reason && <p className="text-destructive">{workItem.fail_reason as string}</p>}
            <p>{isKo ? "사유" : "原因"}: {detail}</p>
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} className="gap-1 bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-white" onClick={confirmDone}>
            <CheckCircle2 className="w-3.5 h-3.5" /> {isKo ? "확인 완료" : "确认完成"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} className="gap-1" onClick={sendToRework}>
            <RotateCcw className="w-3.5 h-3.5" /> {isKo ? "재작업" : "返工"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy} className="gap-1 ml-auto text-destructive">
                <Trash2 className="w-3.5 h-3.5" /> {isKo ? "삭제" : "删除"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isKo ? "이 불량 기록을 삭제할까요?" : "删除该不良记录？"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isKo
                    ? "기록이 목록에서 완전히 삭제됩니다. 작업 영상과 작업 데이터는 유지됩니다."
                    : "记录将从列表中永久删除。作业视频与作业数据将保留。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isKo ? "취소" : "取消"}</AlertDialogCancel>
                <AlertDialogAction onClick={deleteLog}>{isKo ? "삭제" : "删除"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

    </div>
  );
}

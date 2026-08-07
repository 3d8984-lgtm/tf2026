import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { HardDrive, Loader2, Trash2 } from "lucide-react";

/** Retention policy for work videos: auto-delete old normal videos, keep defect/claim ones. */
export default function WorkVideoRetentionSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["work_video_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_video_settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["work_video_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_video_records")
        .select("has_defect, retain, deleted_at, size_bytes, created_at");
      if (error) throw error;
      const live = (data ?? []).filter(r => !r.deleted_at);
      return {
        total: live.length,
        kept: live.filter(r => r.has_defect || r.retain).length,
        deleted: (data ?? []).length - live.length,
        bytes: live.reduce((s, r) => s + (r.size_bytes ?? 0), 0),
      };
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["work_video_recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_video_records")
        .select("id, path, external_order_id, item_no, has_defect, retain, deleted_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const patch = async (values: Record<string, unknown>) => {
    if (!settings) return;
    const { error } = await supabase.from("work_video_settings").update(values).eq("id", settings.id);
    if (error) { toast({ title: isKo ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["work_video_settings"] });
    toast({ title: isKo ? "저장됨" : "已保存" });
  };

  const toggleRetain = async (id: string, retain: boolean) => {
    const { error } = await supabase.from("work_video_records").update({ retain }).eq("id", id);
    if (error) { toast({ title: isKo ? "변경 실패" : "更新失败", description: error.message, variant: "destructive" }); return; }
    qc.invalidateQueries({ queryKey: ["work_video_recent"] });
    qc.invalidateQueries({ queryKey: ["work_video_stats"] });
  };

  const runCleanup = async (dryRun: boolean) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("work-video-cleanup", { body: { dry_run: dryRun } });
      if (error) throw error;
      toast({
        title: dryRun ? (isKo ? "삭제 예정 건수" : "待删除数量") : (isKo ? "정리 완료" : "清理完成"),
        description: dryRun
          ? `${data?.candidates ?? 0}${isKo ? "건" : "件"}`
          : `${data?.deleted ?? 0}${isKo ? "건 삭제됨" : "件已删除"}`,
      });
      qc.invalidateQueries({ queryKey: ["work_video_settings"] });
      qc.invalidateQueries({ queryKey: ["work_video_stats"] });
      qc.invalidateQueries({ queryKey: ["work_video_recent"] });
    } catch (e: any) {
      toast({ title: isKo ? "실행 실패" : "执行失败", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const gb = ((stats?.bytes ?? 0) / 1024 / 1024 / 1024).toFixed(2);

  return (
    <div className="space-y-4 section-enter">
      <div className="kpi-card">
        <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
          <HardDrive className="w-4 h-4" /> {isKo ? "작업 영상 보관 정책" : "作业视频保留策略"}
        </h3>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label className="text-xs">{isKo ? "자동 삭제 사용" : "启用自动删除"}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isKo ? "매일 새벽 자동 실행" : "每日凌晨自动执行"}
              </p>
            </div>
            <Switch checked={!!settings?.enabled} onCheckedChange={v => patch({ enabled: v })} />
          </div>

          <div className="rounded-lg border border-border p-3">
            <Label className="text-xs">{isKo ? "보관 기간(일)" : "保留天数"}</Label>
            <div className="flex gap-2 mt-2">
              {[30, 60, 90].map(d => (
                <Button key={d} size="sm" variant={settings?.retention_days === d ? "default" : "outline"}
                  className="h-7 px-2 text-xs" onClick={() => patch({ retention_days: d })}>
                  {d}{isKo ? "일" : "天"}
                </Button>
              ))}
              <Input
                type="number"
                min={1}
                className="h-7 w-20 text-xs"
                defaultValue={settings?.retention_days ?? 90}
                onBlur={e => {
                  const v = Number(e.target.value);
                  if (v > 0 && v !== settings?.retention_days) patch({ retention_days: v });
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label className="text-xs">{isKo ? "불량·클레임 건 보존" : "保留不良/索赔件"}</Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {isKo ? "검증 실패 영상은 삭제하지 않음" : "验证失败视频不删除"}
              </p>
            </div>
            <Switch checked={!!settings?.keep_defects} onCheckedChange={v => patch({ keep_defects: v })} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-muted-foreground">
          <span>{isKo ? "보관 중" : "保留中"}: <b className="text-foreground">{stats?.total ?? 0}</b></span>
          <span>{isKo ? "보존 지정" : "已标记保存"}: <b className="text-foreground">{stats?.kept ?? 0}</b></span>
          <span>{isKo ? "삭제됨" : "已删除"}: <b className="text-foreground">{stats?.deleted ?? 0}</b></span>
          <span>{isKo ? "용량" : "容量"}: <b className="text-foreground">{gb} GB</b></span>
          {settings?.last_run_at && (
            <span>
              {isKo ? "마지막 실행" : "上次执行"}: {new Date(settings.last_run_at).toLocaleString(isKo ? "ko-KR" : "zh-CN")}
              {" "}({settings.last_run_deleted ?? 0})
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={running} onClick={() => runCleanup(true)}>
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {isKo ? "미리보기" : "预览"}
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs" disabled={running} onClick={() => runCleanup(false)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> {isKo ? "지금 정리" : "立即清理"}
            </Button>
          </div>
        </div>
      </div>

      <div className="kpi-card">
        <h3 className="text-sm font-medium mb-3">{isKo ? "최근 작업 영상" : "最近作业视频"}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{isKo ? "주문" : "订单"}</TableHead>
              <TableHead className="text-xs">{isKo ? "작업번호" : "作业号"}</TableHead>
              <TableHead className="text-xs">{isKo ? "결과" : "结果"}</TableHead>
              <TableHead className="text-xs">{isKo ? "생성일" : "创建日"}</TableHead>
              <TableHead className="text-xs">{isKo ? "영구 보존" : "永久保留"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(recent ?? []).map(r => (
              <TableRow key={r.id} className={r.deleted_at ? "opacity-50" : ""}>
                <TableCell className="text-xs">{r.external_order_id ?? "-"}</TableCell>
                <TableCell className="text-xs">{r.item_no ?? "-"}</TableCell>
                <TableCell className="text-xs">
                  {r.deleted_at ? (
                    <Badge variant="outline">{isKo ? "삭제됨" : "已删除"}</Badge>
                  ) : r.has_defect ? (
                    <Badge variant="destructive">{isKo ? "불량" : "不良"}</Badge>
                  ) : (
                    <Badge variant="secondary">{isKo ? "정상" : "正常"}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN")}</TableCell>
                <TableCell>
                  <Switch checked={!!r.retain} disabled={!!r.deleted_at} onCheckedChange={v => toggleRetain(r.id, v)} />
                </TableCell>
              </TableRow>
            ))}
            {(recent ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                {isKo ? "기록이 없습니다" : "暂无记录"}
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { scanSuccess, scanFail } from "@/lib/scan-sound";
import WorkCamRecorder from "@/components/WorkCamRecorder";
import { useOrderNoMap } from "@/hooks/useOrderNoMap";
import { QC_GROUPS, QC_TOTAL, qcCheckedCount, qcIsComplete, qcKey, type QcChecks } from "@/lib/tshirt-quality";
import {
  ChevronLeft, ScanLine, Loader2, CheckCircle2, XCircle, Circle, Video, Play, AlertTriangle,
} from "lucide-react";

interface Item {
  seq: number;
  itemNo: string;
  qr: string;
  color: string;
  size: string;
}

const norm = (v: string) => (v || "").trim().toUpperCase();

export default function TshirtQualityDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const { data: orderNoMap } = useOrderNoMap();

  const { data: order, isLoading } = useQuery({
    queryKey: ["tshirt_quality_order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, external_order_id, product_code, design_code, quantity, recipient_name, project_completed_at, created_at, source_data")
        .eq("id", orderId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const orderNo = orderId ? orderNoMap?.[orderId] ?? "" : "";

  const items = useMemo<Item[]>(() => {
    const src = (order?.source_data as any)?.items;
    const list: any[] = Array.isArray(src) ? src : [];
    const count = Math.max(list.length, order?.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = list[idx] ?? {};
      const itemNo = String(it.order_id ?? it.sequence_no ?? `${order?.external_order_id ?? ""}-${idx + 1}`);
      return {
        seq: idx + 1,
        itemNo,
        qr: `${itemNo}-3`,
        color: it.tshirt_color ?? "",
        size: it.tshirt_size ?? "",
      };
    });
  }, [order]);


  // ---- Saved inspections ----
  const { data: inspections } = useQuery({
    queryKey: ["tshirt_quality_inspections", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tshirt_quality_inspections")
        .select("*")
        .eq("order_id", orderId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const bySeq = useMemo(() => {
    const map: Record<number, any> = {};
    for (const row of inspections ?? []) map[row.seq as number] = row;
    return map;
  }, [inspections]);

  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const active = items.find((i) => i.seq === activeSeq) ?? null;
  const activeRow = activeSeq != null ? bySeq[activeSeq] : null;
  const activeChecks: QcChecks = (activeRow?.checks as QcChecks) ?? {};

  // ---- Recording ----
  const folder = order?.external_order_id ?? "";
  const [recordingSeq, setRecordingSeq] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const recordTargetRef = useRef<{ seq: number; qr: string } | null>(null);

  const { data: videos } = useQuery({
    queryKey: ["tshirt_quality_videos", folder],
    enabled: !!folder,
    queryFn: async () => {
      const { data } = await supabase.storage.from("work-videos").list(folder, { limit: 1000 });
      const map: Record<string, { path: string; name: string }[]> = {};
      for (const f of data ?? []) {
        const base = f.name.replace(/\.[^.]+$/, "");
        if (!base.startsWith("QC-")) continue;
        const key = base.split("__")[0].slice(3);
        (map[key] ??= []).push({ path: `${folder}/${f.name}`, name: base });
      }
      for (const l of Object.values(map)) l.sort((a, b) => a.name.localeCompare(b.name));
      return map;
    },
  });

  const handleRecorded = useCallback(async (blob: Blob) => {
    const target = recordTargetRef.current;
    if (!target || !folder || !orderId) return;
    setUploading(true);
    const path = `${folder}/QC-${target.qr}__${Date.now()}.webm`;
    try {
      const { error: upErr } = await supabase.storage
        .from("work-videos")
        .upload(path, blob, { contentType: "video/webm", upsert: true });
      if (upErr) {
        toast.error(tr("영상 저장 실패", "视频保存失败"), { description: upErr.message });
        return;
      }
      await supabase.from("work_video_records").upsert({
        bucket: "work-videos",
        path,
        order_id: orderId,
        external_order_id: folder,
        item_no: target.qr,
        has_defect: false,
        size_bytes: blob.size,
        deleted_at: null,
      }, { onConflict: "path" });

      const { data: auth } = await supabase.auth.getUser();
      await supabase.from("tshirt_quality_inspections").upsert({
        order_id: orderId,
        seq: target.seq,
        item_no: items.find((i) => i.seq === target.seq)?.itemNo ?? null,
        qr_value: target.qr,
        video_path: path,
        inspected_by: auth.user?.id ?? null,
      }, { onConflict: "order_id,seq" });

      toast.success(tr("검사 영상 저장됨", "检验视频已保存"), { description: path });
      queryClient.invalidateQueries({ queryKey: ["tshirt_quality_videos", folder] });
      queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections", orderId] });
    } finally {
      setUploading(false);
      recordTargetRef.current = null;
    }
  }, [folder, orderId, items, queryClient, isKo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Scan handling ----
  const [scanValue, setScanValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [items.length]);

  const handleScan = useCallback((raw: string) => {
    const value = norm(raw);
    if (!value) return;
    setScanValue("");
    const item = items.find((i) => norm(i.qr) === value || norm(i.itemNo) === value);
    if (!item) {
      scanFail();
      toast.error(tr("등록되지 않은 고유번호입니다", "未登记的唯一编号"), { description: value });
      return;
    }
    if (recordingSeq === item.seq) {
      // Second scan of the same code stops the recording.
      setRecordingSeq(null);
      scanSuccess();
      toast.success(tr("녹화 종료 · 저장 중", "录像结束 · 保存中"), { description: item.qr });
      return;
    }
    if (recordingSeq != null) {
      scanFail();
      toast.error(
        tr("다른 항목 녹화 중입니다", "正在录制其他项目"),
        { description: tr("동일한 고유번호를 다시 스캔해 종료하세요", "请再次扫描相同编号以结束") },
      );
      return;
    }
    recordTargetRef.current = { seq: item.seq, qr: item.qr };
    setActiveSeq(item.seq);
    setRecordingSeq(item.seq);
    scanSuccess();
    toast.success(tr("녹화 시작", "开始录像"), { description: item.qr });
  }, [items, recordingSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Checklist persistence ----
  const saveChecks = useCallback(async (seq: number, checks: QcChecks, note?: string | null, result?: string) => {
    if (!orderId) return;
    const item = items.find((i) => i.seq === seq);
    const complete = qcIsComplete(checks);
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("tshirt_quality_inspections").upsert({
      order_id: orderId,
      seq,
      item_no: item?.itemNo ?? null,
      qr_value: item?.qr ?? null,
      checks,
      note: note ?? bySeq[seq]?.note ?? null,
      result: result ?? (complete ? "pass" : "pending"),
      inspected_by: auth.user?.id ?? null,
      inspected_at: new Date().toISOString(),
    }, { onConflict: "order_id,seq" });
    if (error) {
      toast.error(tr("검사 결과 저장 실패", "检验结果保存失败"), { description: error.message });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections", orderId] });
    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections_summary"] });
  }, [orderId, items, bySeq, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCheck = (group: string, check: string, on: boolean) => {
    if (activeSeq == null) return;
    const next = { ...activeChecks, [qcKey(group, check)]: on };
    saveChecks(activeSeq, next, undefined, activeRow?.result === "fail" ? "fail" : undefined);
  };

  const toggleAll = (on: boolean) => {
    if (activeSeq == null) return;
    const next: QcChecks = {};
    for (const g of QC_GROUPS) for (const c of g.checks) next[qcKey(g.key, c.key)] = on;
    saveChecks(activeSeq, next);
  };

  const [note, setNote] = useState("");
  useEffect(() => { setNote(activeRow?.note ?? ""); }, [activeSeq, activeRow?.note]);

  // ---- Video playback ----
  const [playing, setPlaying] = useState<{ title: string; url: string } | null>(null);
  const openVideo = async (path: string, title: string) => {
    const { data } = await supabase.storage.from("work-videos").createSignedUrl(path, 60 * 60);
    if (!data?.signedUrl) {
      toast.error(tr("영상을 불러올 수 없습니다", "无法加载视频"));
      return;
    }
    setPlaying({ title, url: data.signedUrl });
  };

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!order) {
    return (
      <div className="p-6">
        <Button variant="outline" onClick={() => navigate("/tshirt-quality")}>
          <ChevronLeft className="w-4 h-4 mr-1" />{tr("목록으로", "返回列表")}
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">{tr("주문을 찾을 수 없습니다", "未找到订单")}</p>
      </div>
    );
  }

  const doneCount = items.filter((i) => qcIsComplete(bySeq[i.seq]?.checks)).length;
  const failCount = items.filter((i) => bySeq[i.seq]?.result === "fail").length;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("티셔츠 품질 검사", "T恤品质检验")}
        description={`${order.external_order_id} · ${order.recipient_name} · ${tr("검사 완료", "已完成")} ${doneCount}/${items.length}`}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/tshirt-quality")}>
            <ChevronLeft className="w-4 h-4 mr-1" />{tr("주문 목록", "订单列表")}
          </Button>
          {failCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" />{tr("불량", "不良")} {failCount}
            </Badge>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* Left: item list + checklist */}
          <div className="space-y-4">
            <div className="kpi-card">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <ScanLine className="w-4 h-4" />{tr("스티커 고유번호 스캔", "扫描贴纸唯一编号")}
              </h3>
              <Input
                ref={inputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(scanValue); } }}
                placeholder={tr("스캔하면 녹화 시작 · 같은 번호를 다시 스캔하면 종료", "扫描开始录像 · 再次扫描相同编号结束")}
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-2">
                {recordingSeq != null
                  ? tr(`녹화 중: ${items.find(i => i.seq === recordingSeq)?.qr ?? ""}`, `录像中：${items.find(i => i.seq === recordingSeq)?.qr ?? ""}`)
                  : tr("대기 중", "待机中")}
              </p>
            </div>

            <div className="rounded-lg border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">{tr("스티커 고유번호", "贴纸唯一编号")}</th>
                    <th className="text-left px-3 py-2 font-medium">{tr("색상/사이즈", "颜色/尺码")}</th>
                    <th className="text-left px-3 py-2 font-medium">{tr("검사 항목", "检验项")}</th>
                    <th className="text-left px-3 py-2 font-medium">{tr("영상", "视频")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const row = bySeq[i.seq];
                    const cnt = qcCheckedCount(row?.checks);
                    const takes = videos?.[i.qr] ?? [];
                    return (
                      <tr
                        key={i.seq}
                        className={`border-t cursor-pointer hover:bg-muted/20 ${activeSeq === i.seq ? "bg-primary/5" : ""}`}
                        onClick={() => setActiveSeq(i.seq)}
                      >
                        <td className="px-3 py-2">{i.seq}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {i.qr || "-"}
                          {recordingSeq === i.seq && (
                            <span className="ml-2 text-destructive text-[10px] font-medium animate-pulse">REC</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{[i.color, i.size].filter(Boolean).join(" / ") || "-"}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5">
                            {row?.result === "fail" ? <XCircle className="w-4 h-4 text-destructive" />
                              : cnt === QC_TOTAL ? <CheckCircle2 className="w-4 h-4 text-success" />
                              : <Circle className="w-4 h-4 text-muted-foreground/50" />}
                            <span className="text-xs">{cnt}/{QC_TOTAL}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {takes.length === 0 ? (
                            <span className="text-xs text-muted-foreground">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {takes.map((t, idx) => (
                                <Button
                                  key={t.path}
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={(e) => { e.stopPropagation(); openVideo(t.path, `${i.qr} #${idx + 1}`); }}
                                >
                                  <Play className="w-3 h-3 mr-1" />{idx + 1}
                                </Button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {active && (
              <div className="kpi-card space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    {tr("검사 항목", "检验项")} · <span className="font-mono">{active.qr || active.itemNo}</span>
                  </h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggleAll(true)}>{tr("전체 확인", "全部合格")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAll(false)}>{tr("전체 해제", "全部清除")}</Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {QC_GROUPS.map((g) => (
                    <div key={g.key} className="rounded-lg border p-3">
                      <p className="text-sm font-medium mb-2">{isKo ? g.ko : g.zh}</p>
                      <div className="space-y-2">
                        {g.checks.map((c) => {
                          const k = qcKey(g.key, c.key);
                          return (
                            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={!!activeChecks[k]}
                                onCheckedChange={(v) => toggleCheck(g.key, c.key, !!v)}
                              />
                              <span>{isKo ? c.ko : c.zh}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={tr("특이사항 / 불량 내용", "备注 / 不良内容")}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveChecks(active.seq, activeChecks, note)}>
                      {tr("저장", "保存")}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => saveChecks(active.seq, activeChecks, note, "fail")}>
                      <XCircle className="w-4 h-4 mr-1" />{tr("불량 처리", "判定不良")}
                    </Button>
                    {activeRow?.result === "fail" && (
                      <Button size="sm" variant="outline" onClick={() => saveChecks(active.seq, activeChecks, note, qcIsComplete(activeChecks) ? "pass" : "pending")}>
                        {tr("불량 해제", "取消不良")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: camera */}
          <div className="space-y-4">
            <WorkCamRecorder recording={recordingSeq != null} onRecorded={handleRecorded} uploading={uploading} />
            <div className="kpi-card">
              <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Video className="w-4 h-4" />{tr("사용 방법", "使用方法")}</h3>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{tr("스티커 고유번호를 스캔하면 녹화가 시작됩니다", "扫描贴纸唯一编号后开始录像")}</li>
                <li>{tr("검사 항목을 확인하며 작업합니다", "边检查项目边作业")}</li>
                <li>{tr("동일한 고유번호를 다시 스캔하면 녹화가 종료되고 서버에 저장됩니다", "再次扫描相同编号即结束录像并保存至服务器")}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{playing?.title}</DialogTitle></DialogHeader>
          {playing && <video src={playing.url} controls autoPlay className="w-full rounded-lg bg-black" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { scanSuccess, scanFail } from "@/lib/scan-sound";
import WorkCamRecorder from "@/components/WorkCamRecorder";
import { useOrderNoMap } from "@/hooks/useOrderNoMap";
import { QC_GROUPS, QC_TOTAL, qcCheckedCount, qcIsComplete, qcKey, type QcChecks } from "@/lib/tshirt-quality";
import { latinCharFromEvent, normalizeScan, SCANNER_BLOCKED_KEYS } from "@/lib/scan-keys";
import {
  ChevronLeft, ScanLine, Loader2, CheckCircle2, XCircle, Circle, Video, Play, AlertTriangle,
  QrCode, Hash, Image as ImageIcon, RotateCcw,
} from "lucide-react";

interface Item {
  seq: number;
  itemNo: string;
  qr: string;
  color: string;
  size: string;
  designUrl: string | null;
  twincodeUrl: string | null;
}

const norm = normalizeScan;

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
        designUrl: it.gft_original_image_url ?? it.design_image_url ?? null,
        twincodeUrl: it.twincode_svg_url ?? it.twincode_url ?? null,
      };
    });
  }, [order]);

  const folder = order?.external_order_id ?? "";

  // ---- Reference images (design / twincode) from storage, same as the attach workstation ----
  const { data: designImageFiles } = useQuery({
    queryKey: ["qc_design_images", folder],
    enabled: !!folder,
    queryFn: async () => {
      const { data: files } = await supabase.storage.from("design-images").list(folder);
      const map: Record<string, string> = {};
      for (const f of files ?? []) {
        map[f.name.replace(/\.[^.]+$/, "")] = supabase.storage.from("design-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
      }
      return map;
    },
  });

  const { data: twincodeImageFiles } = useQuery({
    queryKey: ["qc_twincode_images", folder],
    enabled: !!folder,
    queryFn: async () => {
      const { data: files } = await supabase.storage.from("twincode-images").list(folder);
      const map: Record<string, string> = {};
      for (const f of files ?? []) {
        map[f.name.replace(/\.[^.]+$/, "")] = supabase.storage.from("twincode-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
      }
      return map;
    },
  });

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
  const [localChecks, setLocalChecks] = useState<Record<number, QcChecks>>({});
  const active = items.find((i) => i.seq === activeSeq) ?? null;
  const activeRow = activeSeq != null ? bySeq[activeSeq] : null;
  const checksOf = (seq: number): QcChecks =>
    localChecks[seq] ?? ((bySeq[seq]?.checks as QcChecks) ?? {});
  const activeChecks: QcChecks = activeSeq != null ? checksOf(activeSeq) : {};
  const activeResolved = activeRow?.result === "resolved";
  const activePass = activeSeq != null && activeRow?.result !== "fail" && !activeResolved && qcIsComplete(activeChecks);
  const activeFail = activeRow?.result === "fail";


  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);

  const refFor = (item: Item) => {
    const dCands = [`${item.itemNo}-2`, item.itemNo, String(item.seq)];
    const dKey = dCands.find((c) => c && designImageFiles?.[c]);
    const tCands = [item.itemNo, `${item.itemNo}-2`, String(item.seq)];
    const tKey = tCands.find((c) => c && twincodeImageFiles?.[c]);
    return {
      design: (dKey && designImageFiles?.[dKey]) || item.designUrl || null,
      designKey: dKey ?? `${item.itemNo}-2`,
      twincode: (tKey && twincodeImageFiles?.[tKey]) || item.twincodeUrl || null,
      twincodeKey: tKey ?? item.itemNo,
    };
  };

  // ---- Recording ----
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
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [items.length]);

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

  // 스캐너 입력 자동 처리 (Enter 없이도 인식)
  const scanRef = useRef(handleScan);
  useEffect(() => { scanRef.current = handleScan; }, [handleScan]);

  useEffect(() => {
    const v = scanValue.trim();
    if (!v) return;
    const t = setTimeout(() => {
      const value = norm(v);
      const matched = items.some((i) => norm(i.qr) === value || norm(i.itemNo) === value);
      if (matched) scanRef.current(v);
    }, 120);
    return () => clearTimeout(t);
  }, [scanValue, items]);

  // ---- Global scanner capture (IME-proof, works even when input lost focus) ----
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);
  const scanValueRef = useRef("");
  useEffect(() => { scanValueRef.current = scanValue; }, [scanValue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const editable = el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el !== inputRef.current));
      if (editable || e.isComposing || e.key === "Process" || (e as any).keyCode === 229) return;

      const block = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

      // Scanner prefix/suffix keys (Ctrl+F, Tab, F-keys…) must never reach
      // browser search / sidebar shortcuts while the workstation is active.
      if (e.ctrlKey || e.metaKey || e.altKey || SCANNER_BLOCKED_KEYS.has(e.key)
        || e.key === "Control" || e.key === "Meta" || e.key === "Alt") {
        block();
        inputRef.current?.focus({ preventScroll: true });
        return;
      }

      const now = Date.now();
      if (now - lastKeyRef.current > 1000) bufferRef.current = "";
      lastKeyRef.current = now;

      if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
        block();
        const value = bufferRef.current || scanValueRef.current;
        bufferRef.current = "";
        scanRef.current(value);
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (e.key === "Backspace" || e.code === "Backspace") {
        block();
        bufferRef.current = bufferRef.current.slice(0, -1);
        setScanValue(bufferRef.current);
        return;
      }
      const ch = latinCharFromEvent(e);
      if (ch) {
        block();
        bufferRef.current += ch;
        setScanValue(bufferRef.current);
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el !== inputRef.current))) return;
      if (e.ctrlKey || e.metaKey || e.altKey || SCANNER_BLOCKED_KEYS.has(e.key) || e.key === "Control" || e.key === "Meta" || e.key === "Alt") {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  useEffect(() => {
    const refocus = () => {
      const el = document.activeElement as HTMLElement | null;
      // Keep focus on controls being operated. Scanner keystrokes are captured
      // globally, so moving focus away from a checkbox is unnecessary and
      // previously caused the page to jump back to the scan field.
      if (el && el !== document.body && el !== document.documentElement) return;
      inputRef.current?.focus({ preventScroll: true });
    };
    const id = window.setInterval(refocus, 800);
    window.addEventListener("click", refocus);
    return () => { window.clearInterval(id); window.removeEventListener("click", refocus); };
  }, []);


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
    if (result === "fail") {
      const { error: logErr } = await supabase.from("defect_logs").insert({
        source: "tshirt_quality",
        order_id: orderId,
        external_order_id: folder || null,
        item_no: item?.itemNo ?? null,
        seq,
        defect_type: "quality_fail",
        severity: "medium",
        occurred_process: isKo ? "티셔츠 품질 검사" : "T恤品质检验",
        detail: note ?? null,
        status: "rework_queued",
        restart_stage: "tshirt",
        created_by: auth.user?.id ?? null,
      });
      if (logErr) toast.error(tr("불량 로그 기록 실패", "不良日志记录失败"), { description: logErr.message });
      else queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
    }
    // Closing out a defect: mark the matching defect log entries as resolved
    // so the 불량/예외 관리 board also shows 처리 완료.
    if (result === "resolved") {
      const { error: logErr } = await supabase.from("defect_logs")
        .update({
          status: "rework_done",
          resolved_at: new Date().toISOString(),
          detail: note ?? null,
        })
        .eq("order_id", orderId)
        .eq("seq", seq)
        .eq("source", "tshirt_quality")
        .neq("status", "rework_done");
      if (logErr) toast.error(tr("불량 로그 갱신 실패", "不良日志更新失败"), { description: logErr.message });
      else {
        queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
        toast.success(tr("불량 처리완료 되었습니다", "已完成不良处理"));
      }
    }

    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections", orderId] });
    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections_summary"] });
  }, [orderId, items, bySeq, queryClient, folder, isKo]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCheck = (group: string, check: string, on: boolean) => {
    if (activeSeq == null) return;
    const seq = activeSeq;
    const next = { ...checksOf(seq), [qcKey(group, check)]: on };
    setLocalChecks((prev) => ({ ...prev, [seq]: next }));
    if (on && qcIsComplete(next) && bySeq[seq]?.result !== "fail") scanSuccess();
    const keep = bySeq[seq]?.result;
    saveChecks(seq, next, undefined, keep === "fail" || keep === "resolved" ? keep : undefined);
  };

  const toggleAll = (on: boolean) => {
    if (activeSeq == null) return;
    const seq = activeSeq;
    const next: QcChecks = {};
    for (const g of QC_GROUPS) for (const c of g.checks) next[qcKey(g.key, c.key)] = on;
    setLocalChecks((prev) => ({ ...prev, [seq]: next }));
    if (on) scanSuccess();
    saveChecks(seq, next);
  };


  const [note, setNote] = useState("");
  useEffect(() => { setNote(activeRow?.note ?? ""); }, [activeSeq, activeRow?.note]);

  // ---- Reset every inspection record for this order ----
  const [resetting, setResetting] = useState(false);
  const resetOrder = useCallback(async () => {
    if (!orderId) return;
    setResetting(true);
    const { error } = await supabase
      .from("tshirt_quality_inspections")
      .delete()
      .eq("order_id", orderId);
    if (error) {
      setResetting(false);
      toast.error(tr("초기화 실패", "重置失败"), { description: error.message });
      return;
    }
    const { error: logErr } = await supabase
      .from("defect_logs")
      .delete()
      .eq("order_id", orderId)
      .eq("source", "tshirt_quality");
    setResetting(false);
    if (logErr) {
      toast.error(tr("불량 기록 초기화 실패", "不良记录重置失败"), { description: logErr.message });
      return;
    }
    setLocalChecks({});
    setNote("");
    setActiveSeq(null);
    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections", orderId] });
    queryClient.invalidateQueries({ queryKey: ["tshirt_quality_inspections_summary"] });
    queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
    toast.success(tr("초기화되었습니다", "已重置"));
  }, [orderId, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps


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

  const doneCount = items.filter((i) => bySeq[i.seq]?.result === "resolved" || (qcIsComplete(checksOf(i.seq)) && bySeq[i.seq]?.result !== "fail")).length;
  const failCount = items.filter((i) => bySeq[i.seq]?.result === "fail").length;
  const resolvedCount = items.filter((i) => bySeq[i.seq]?.result === "resolved").length;
  const pct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;
  const activeRef = active ? refFor(active) : null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("티셔츠 품질 검사", "T恤品质检验")}
        description={`${orderNo ? orderNo + " · " : ""}${order.external_order_id} · ${order.recipient_name} · ${tr("검사 완료", "已完成")} ${doneCount}/${items.length}`}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => navigate("/tshirt-quality")}>
            <ChevronLeft className="w-4 h-4 mr-1" />{tr("주문 목록", "订单列表")}
          </Button>
          <div className="flex items-center gap-2 min-w-[180px]">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${doneCount >= items.length && items.length > 0 ? "bg-[hsl(var(--success))]" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-14 text-right">{doneCount}/{items.length}</span>
          </div>
          {failCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" />{tr("불량", "不良")} {failCount}
            </Badge>
          )}
          {resolvedCount > 0 && (
            <Badge variant="outline" className="gap-1 border-[hsl(var(--success))] text-[hsl(var(--success))]">
              <CheckCircle2 className="w-3 h-3" />{tr("불량 처리완료", "不良处理完成")} {resolvedCount}
            </Badge>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto gap-1 text-destructive" disabled={resetting}>
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {tr("초기화", "重置")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tr("이 주문의 검사 내용을 모두 초기화할까요?", "确定重置该订单的全部检验内容？")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {tr(
                    "체크리스트, 특이사항, 합격/불량 판정과 관련 불량 기록이 모두 삭제됩니다. 저장된 작업 영상은 유지됩니다.",
                    "检查清单、备注、合格/不良判定及相关不良记录将全部删除。已保存的作业视频将保留。",
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tr("취소", "取消")}</AlertDialogCancel>
                <AlertDialogAction onClick={resetOrder}>{tr("초기화", "重置")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>


        {/* Large O/X indicator for the active item */}
        {active && (activePass || activeFail || activeResolved) && (
          <div className={`rounded-xl border-2 p-5 flex items-center gap-5 ${activeFail ? "border-destructive bg-destructive/5" : "border-[hsl(var(--success))] bg-[hsl(var(--success)/0.06)]"}`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl font-black ${activeFail ? "bg-destructive/10 text-destructive" : "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"}`}>
              {activeFail ? "X" : "O"}
            </div>
            <div>
              <p className={`text-lg font-bold ${activeFail ? "text-destructive" : "text-[hsl(var(--success))]"}`}>
                {activeFail ? tr("불량 판정", "判定不良")
                  : activeResolved ? tr("불량 처리완료", "不良处理完成")
                  : tr("검사 합격", "检验合格")}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5 font-mono">{active.qr}</p>
            </div>
          </div>
        )}


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

            {/* Reference images for the active item */}
            {active && (
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  { title: tr("디자인 확인", "设计确认"), url: activeRef?.design ?? null, key: activeRef?.designKey ?? "", Icon: QrCode, alt: "Design" },
                  { title: tr("트윈코드 확인", "TwinCode确认"), url: activeRef?.twincode ?? null, key: activeRef?.twincodeKey ?? "", Icon: Hash, alt: "TwinCode" },
                ]).map(({ title, url, key, Icon, alt }) => (
                  <div key={alt} className="kpi-card flex flex-col min-h-[180px]">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2"><Icon className="w-4 h-4" />{title}</h3>
                    {url ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-2">
                        <div
                          className="w-28 h-28 rounded-lg border-2 border-border bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
                          onClick={() => setZoomed({ src: url, alt })}
                        >
                          <img src={url} alt={alt} loading="lazy" className="max-w-full max-h-full object-contain" />
                        </div>
                        <span className="text-xs text-muted-foreground">{tr("클릭하여 확대", "点击放大")} · <span className="font-mono">{key}</span></span>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <ImageIcon className="w-8 h-8 opacity-30" />
                        <p className="text-xs">{tr("이미지 없음", "无图片")}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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
                    const cnt = qcCheckedCount(checksOf(i.seq));
                    const takes = videos?.[i.qr] ?? [];
                    return (
                      <tr
                        key={i.seq}
                        className={`border-t cursor-pointer hover:bg-muted/20 ${row?.result === "fail" ? "bg-destructive/10 hover:bg-destructive/15" : activeSeq === i.seq ? "bg-primary/5" : ""}`}
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
                            {row?.result === "resolved" && (
                              <Badge variant="outline" className="text-[10px] border-[hsl(var(--success))] text-[hsl(var(--success))]">
                                {tr("불량 처리완료", "不良处理完成")}
                              </Badge>
                            )}
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
                  <div className="flex gap-2 items-center flex-wrap">
                    <Button size="sm" onClick={() => saveChecks(active.seq, activeChecks, note)}>
                      {tr("저장", "保存")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!note.trim()}
                      onClick={() => { scanFail(); saveChecks(active.seq, activeChecks, note, "fail"); }}
                    >
                      <XCircle className="w-4 h-4 mr-1" />{tr("불량 처리", "判定不良")}
                    </Button>
                    {activeRow?.result === "fail" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!note.trim()}
                        onClick={() => saveChecks(active.seq, activeChecks, note, "resolved")}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />{tr("불량 처리완료", "不良处理完成")}
                      </Button>
                    )}
                    {!note.trim() && (
                      <span className="text-xs text-muted-foreground">
                        {tr("특이사항 / 불량 내용을 입력해야 불량 처리가 가능합니다", "需填写备注 / 不良内容后方可进行不良处理")}
                      </span>
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

      <Dialog open={!!zoomed} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="max-w-3xl p-2 bg-background">
          <DialogHeader><DialogTitle className="sr-only">{zoomed?.alt}</DialogTitle></DialogHeader>
          {zoomed && <img src={zoomed.src} alt={zoomed.alt} className="w-full max-h-[80vh] object-contain" />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!playing} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{playing?.title}</DialogTitle></DialogHeader>
          {playing && <video src={playing.url} controls autoPlay className="w-full rounded-lg bg-black" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

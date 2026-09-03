import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Printer, Settings, Eye, Loader2, CheckCircle2, XCircle, Ban, RotateCw,
} from "lucide-react";
import { useQrLabelTemplate } from "@/hooks/useQrLabelTemplate";
import { checkWidth, formatEdition, type QrLabelTemplate } from "@/lib/qr-label-template";
import {
  bridgeHealth, bridgePrinterOnline, bridgePrint, bridgeJobStatus, bridgeCancel,
  labelPayload, computerId,
} from "@/lib/print-bridge";
import QrLabelSettingsDialog from "./QrLabelSettingsDialog";
import QrLabelPreviewDialog from "./QrLabelPreviewDialog";
import { QrImg } from "./LabelCanvas";

export type LabelSource = { position: number; code: string; editionRaw?: unknown };

type RecordStatus =
  | "pending" | "queued" | "printing" | "sent_to_printer" | "completed" | "failed" | "cancelled";

type Rec = {
  id: string;
  position: number;
  sticker_unique_id: string;
  edition_number: string | null;
  status: RecordStatus;
  reprint_count: number;
  error_message: string | null;
  bridge_job_id: string | null;
};

const DONE: RecordStatus[] = ["completed", "sent_to_printer"];

export default function QrLabelPrintPanel({
  kind, orderId, orderNo, items,
}: {
  kind: "card" | "tshirt";
  orderId: string;
  orderNo: string;
  items: LabelSource[];
}) {
  const { lang } = useLang();
  const tr = (ko: string, zh: string) => (lang === "ko" ? ko : zh);

  const { template, save } = useQrLabelTemplate();
  const [records, setRecords] = useState<Record<number, Rec>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reprintTarget, setReprintTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
  const [printerUp, setPrinterUp] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: LabelItemT | null }>({ done: 0, total: 0, current: null });
  const stopRef = useRef(false);

  type LabelItemT = { position: number; code: string; edition: string };

  /** DB 원본 순서(position ASC)를 유지한 라벨 렌더 데이터 — 미리보기/인쇄가 동일 데이터를 쓴다 */
  const labelItems: LabelItemT[] = useMemo(() => {
    const total = items.length;
    return [...items]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ position: i.position, code: i.code, edition: formatEdition(i.editionRaw, i.position, total) }));
  }, [items]);

  // ── 기록 로드 / 누락분 생성 ────────────────────────────────
  const loadRecords = useCallback(async () => {
    const { data } = await supabase
      .from("qr_label_print_records")
      .select("id, position, sticker_unique_id, edition_number, status, reprint_count, error_message, bridge_job_id")
      .eq("order_id", orderId).eq("kind", kind)
      .order("position");
    const map: Record<number, Rec> = {};
    for (const r of (data ?? []) as any[]) map[r.position] = r as Rec;
    setRecords(map);
    return map;
  }, [orderId, kind]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await loadRecords();
      if (!alive || labelItems.length === 0) return;
      const missing = labelItems
        .filter((i) => !map[i.position])
        .map((i) => ({
          order_id: orderId, kind, position: i.position,
          sticker_unique_id: i.code, edition_number: i.edition, status: "pending",
        }));
      if (missing.length > 0) {
        await supabase.from("qr_label_print_records").insert(missing as any);
        await loadRecords();
        return;
      }
      // 주문 데이터의 에디션 값이 바뀐(또는 과거에 임의값으로 저장된) 기록 보정
      const stale = labelItems.filter((i) => map[i.position] && map[i.position].edition_number !== i.edition);
      if (stale.length > 0) {
        await Promise.all(stale.map((i) =>
          supabase.from("qr_label_print_records")
            .update({ edition_number: i.edition })
            .eq("order_id", orderId).eq("kind", kind).eq("position", i.position)
        ));
        await loadRecords();
      }

    })();
    return () => { alive = false; };
  }, [labelItems, loadRecords, orderId, kind]);

  // ── 프린터 / 브리지 상태 ───────────────────────────────────
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const up = template.bridge_enabled ? await bridgeHealth(template.bridge_url) : false;
      if (!alive) return;
      setBridgeUp(up);
      setPrinterUp(up ? await bridgePrinterOnline(template.printer_name, template.bridge_url) : false);
    };
    void tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [template.bridge_enabled, template.bridge_url, template.printer_name]);

  const width = checkWidth(template);
  const counts = useMemo(() => {
    let done = 0, failed = 0, pending = 0;
    for (const i of labelItems) {
      const s = records[i.position]?.status ?? "pending";
      if (DONE.includes(s)) done++;
      else if (s === "failed") failed++;
      else pending++;
    }
    return { total: labelItems.length, done, failed, pending };
  }, [labelItems, records]);

  const patchRecord = useCallback(async (position: number, patch: Partial<Rec> & Record<string, unknown>) => {
    setRecords((p) => (p[position] ? { ...p, [position]: { ...p[position], ...(patch as any) } } : p));
    await supabase.from("qr_label_print_records")
      .update(patch as any).eq("order_id", orderId).eq("kind", kind).eq("position", position);
  }, [orderId, kind]);

  // ── FIFO 인쇄 실행 ────────────────────────────────────────
  const runPrint = useCallback(async (targets: LabelItemT[], snapshot: QrLabelTemplate, isReprint = false) => {
    if (targets.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: targets.length, current: targets[0] });

    const { data: auth } = await supabase.auth.getUser();
    const pc = computerId();

    // 중복 전체 인쇄 방지 — active job 확인 후 생성
    const { data: active } = await supabase
      .from("qr_label_print_jobs")
      .select("id").eq("order_id", orderId).eq("kind", kind).eq("status", "active").limit(1);
    if (!isReprint && active && active.length > 0) {
      setRunning(false);
      toast.error(tr("현재 이 주문의 전체 인쇄 작업이 진행 중입니다.", "该订单的整单打印作业正在进行中。"));
      return;
    }

    const { data: job } = await supabase.from("qr_label_print_jobs").insert({
      order_id: orderId, kind, printer_name: snapshot.printer_name, computer_id: pc,
      template: snapshot as any, total: targets.length, status: "active",
      created_by: auth.user?.id ?? null,
    } as any).select("id").single();
    const jobId = (job as any)?.id as string | undefined;

    // 전체를 queued 로 먼저 기록 (FIFO 순서 = position ASC 고정)
    const nowIso = new Date().toISOString();
    for (const it of targets) {
      await patchRecord(it.position, {
        job_id: jobId, status: "queued", queued_at: nowIso, error_message: null,
        printer_name: snapshot.printer_name, computer_id: pc, printed_by: auth.user?.id ?? null,
      } as any);
    }

    let done = 0;
    for (const it of targets) {
      if (stopRef.current) {
        await patchRecord(it.position, { status: "cancelled", cancelled_at: new Date().toISOString() } as any);
        continue;
      }
      setProgress({ done, total: targets.length, current: it });
      await patchRecord(it.position, { status: "printing", sent_at: new Date().toISOString() } as any);
      try {
        const bridgeJobId = `PRINT-${jobId?.slice(0, 8) ?? "X"}-${String(it.position).padStart(4, "0")}`;
        const res = await bridgePrint({
          jobId: bridgeJobId,
          orderId: orderNo,
          printer: snapshot.printer_name,
          label: labelPayload(snapshot),
          items: [{ position: it.position, stickerUniqueId: it.code, editionNumber: it.edition }],
        }, snapshot.bridge_url);

        // 브리지가 실제 출력완료를 알려줄 때까지만 completed 로 승격한다.
        let status = res.status;
        for (let i = 0; i < 20 && (status === "queued" || status === "printing"); i++) {
          await new Promise((r) => setTimeout(r, 500));
          status = (await bridgeJobStatus(res.jobId, snapshot.bridge_url)).status;
        }
        if (status === "failed") {
          await patchRecord(it.position, { status: "failed", failed_at: new Date().toISOString(), error_message: tr("프린터 오류", "打印机错误"), bridge_job_id: res.jobId } as any);
        } else if (status === "completed") {
          await patchRecord(it.position, { status: "completed", completed_at: new Date().toISOString(), bridge_job_id: res.jobId } as any);
        } else {
          // 물리적 출력 완료를 확인할 수 없는 경우 → sent_to_printer 로 남긴다.
          await patchRecord(it.position, { status: "sent_to_printer", completed_at: new Date().toISOString(), bridge_job_id: res.jobId } as any);
        }
      } catch (e: any) {
        await patchRecord(it.position, {
          status: "failed", failed_at: new Date().toISOString(),
          error_message: String(e?.message ?? e).slice(0, 300),
        } as any);
      }
      done++;
      setProgress({ done, total: targets.length, current: it });
    }

    if (jobId) {
      await supabase.from("qr_label_print_jobs")
        .update({ status: stopRef.current ? "cancelled" : "finished", finished_at: new Date().toISOString() } as any)
        .eq("id", jobId);
    }
    setRunning(false);
    await loadRecords();
    toast.success(tr(`인쇄 처리 완료 · ${done}장`, `打印处理完成 · ${done} 张`));
  }, [orderId, orderNo, kind, patchRecord, loadRecords, lang]);

  const guard = () => {
    if (!width.ok) {
      toast.error(tr(
        `현재 라벨 배열 폭은 ${width.requiredMm}mm입니다. 선택된 프린터의 최대 인쇄폭은 ${width.maxMm}mm입니다. 현재 설정으로는 출력할 수 없습니다. 열 개수 또는 라벨 크기를 수정하십시오.`,
        `当前标签排列宽度为 ${width.requiredMm}mm，超过打印机最大打印宽度 ${width.maxMm}mm，无法打印。`,
      ));
      return false;
    }
    if (!bridgeUp || !printerUp) {
      toast.error(tr("프린터 연결 프로그램을 확인해주세요.", "请检查打印机连接程序。"));
      return false;
    }
    return true;
  };

  const startAll = () => { if (guard()) setConfirmOpen(true); };
  const startSelected = () => {
    if (!guard()) return;
    const targets = labelItems.filter((i) => selected.has(i.position));
    if (targets.length === 0) { toast.error(tr("선택된 라벨이 없습니다", "未选择标签")); return; }
    void runPrint(targets, template, true);
  };

  const stopPrint = async () => {
    stopRef.current = true;
    const cur = progress.current;
    const rec = cur ? records[cur.position] : null;
    if (rec?.bridge_job_id) await bridgeCancel(rec.bridge_job_id, template.bridge_url);
    toast.message(tr("남은 대기 작업을 중단합니다 (이미 출력된 라벨은 유지)", "将取消剩余排队作业（已打印标签保持不变）"));
  };

  const doReprint = async (position: number) => {
    const it = labelItems.find((i) => i.position === position);
    if (!it || !guard()) return;
    const cur = records[position];
    await patchRecord(position, { reprint_count: (cur?.reprint_count ?? 0) + 1 } as any);
    await runPrint([it], template, true);
  };

  const statusBadge = (s: RecordStatus, reprint: number) => {
    const map: Record<RecordStatus, { label: string; cls: string; icon?: JSX.Element }> = {
      pending: { label: tr("미인쇄", "未打印"), cls: "text-muted-foreground" },
      queued: { label: tr("대기열", "排队中"), cls: "text-muted-foreground" },
      printing: { label: tr("인쇄 중", "打印中"), cls: "border-primary text-primary" },
      sent_to_printer: { label: tr("프린터 전송됨", "已发送打印机"), cls: "border-amber-500/50 text-amber-500", icon: <CheckCircle2 className="w-3 h-3" /> },
      completed: { label: tr("인쇄완료", "打印完成"), cls: "border-emerald-500/50 text-emerald-500", icon: <CheckCircle2 className="w-3 h-3" /> },
      failed: { label: tr("오류", "错误"), cls: "border-destructive/50 text-destructive", icon: <XCircle className="w-3 h-3" /> },
      cancelled: { label: tr("취소됨", "已取消"), cls: "text-muted-foreground", icon: <Ban className="w-3 h-3" /> },
    };
    const m = map[s] ?? map.pending;
    return (
      <Badge variant="outline" className={`text-[10px] gap-1 shrink-0 ${m.cls}`}>
        {m.icon}{m.label}{reprint > 0 ? ` · ${tr("재인쇄", "重打")} ${reprint}` : ""}
      </Badge>
    );
  };

  const dot = (ok: boolean | null) =>
    ok === null ? "bg-muted-foreground" : ok ? "bg-emerald-500" : "bg-destructive";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Printer className="w-4 h-4" />{tr("QR 라벨 인쇄", "二维码标签打印")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 상태 요약 */}
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{template.printer_display_name}</span>
              <span className={`w-2 h-2 rounded-full ${dot(printerUp)}`} />
              <span className="text-xs text-muted-foreground">
                {printerUp === null ? tr("확인 중", "检测中") : printerUp ? tr("연결됨", "已连接") : tr("연결 안 됨", "未连接")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs">Local Print Bridge</span>
              <span className={`w-2 h-2 rounded-full ${dot(bridgeUp)}`} />
              <span className="text-xs text-muted-foreground">
                {bridgeUp === null ? tr("확인 중", "检测中") : bridgeUp ? tr("실행 중", "运行中") : tr("연결되지 않음", "未连接")}
              </span>
            </div>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{tr("라벨", "标签")} {template.label_width}×{template.label_height}mm / {template.columns}{tr("열", "列")} / {tr("간격", "间距")} {template.horizontal_gap}mm</p>
            <p className={width.ok ? "" : "text-destructive"}>
              {tr("출력 필요폭", "所需打印宽")} {width.requiredMm}mm · {tr("프린터 최대폭", "打印机最大宽")} {width.maxMm}mm
              {width.ok ? "" : ` · ${tr("출력폭 초과", "超出打印宽度")}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-sm tabular-nums">
          <span>{tr("전체", "全部")} <b>{counts.total}</b></span>
          <span className="text-muted-foreground">{tr("미인쇄", "未打印")} <b>{counts.pending}</b></span>
          <span className="text-emerald-500">{tr("완료", "完成")} <b>{counts.done}</b></span>
          <span className="text-destructive">{tr("오류", "错误")} <b>{counts.failed}</b></span>
        </div>

        {running && (
          <div className="space-y-1">
            <div className="h-2 rounded bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {tr("QR 라벨 출력 중", "二维码标签打印中")} · {progress.done}/{progress.total}
              {progress.current && ` · Edition ${progress.current.edition} · ${progress.current.code}`}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setPreviewOpen(true)}>
            <Eye className="w-4 h-4" />{tr("라벨 미리보기", "标签预览")}
          </Button>
          <Button size="sm" className="gap-1" onClick={startAll} disabled={running || counts.total === 0}>
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {tr("전체 인쇄", "整单打印")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={startSelected} disabled={running}>
            {tr("선택 인쇄", "选择打印")}
          </Button>
          {running && (
            <Button variant="destructive" size="sm" className="gap-1" onClick={() => void stopPrint()}>
              <Ban className="w-4 h-4" />{tr("인쇄 중단", "停止打印")}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1 ml-auto" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4" />{tr("라벨 설정", "标签设置")}
          </Button>
        </div>

        {/* 아이템 리스트 */}
        <div className="border rounded-lg max-h-[420px] overflow-auto divide-y">
          {labelItems.map((it) => {
            const rec = records[it.position];
            const s = (rec?.status ?? "pending") as RecordStatus;
            return (
              <div key={it.position} className="flex items-center gap-2 px-2 py-2 text-sm">
                <Checkbox
                  checked={selected.has(it.position)}
                  onCheckedChange={(v) => setSelected((prev) => {
                    const n = new Set(prev);
                    if (v) n.add(it.position); else n.delete(it.position);
                    return n;
                  })}
                />
                <span className="w-7 tabular-nums text-muted-foreground">{it.position}</span>
                <span className="w-16 tabular-nums text-xs">{it.edition}</span>
                <span className="flex-1 font-mono text-xs break-all">{it.code}</span>
                <QrImg value={it.code} level={template.qr_error_level} style={{ width: 24, height: 24 }} />
                {statusBadge(s, rec?.reprint_count ?? 0)}
                {DONE.includes(s) ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 gap-1 text-xs"
                    onClick={() => setReprintTarget(it.position)} disabled={running}>
                    <RotateCw className="w-3.5 h-3.5" />{tr("재인쇄", "重打")}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => { if (guard()) void runPrint([it], template, true); }} disabled={running}>
                    {tr("개별 인쇄", "单张打印")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      <QrLabelSettingsDialog
        open={settingsOpen} onOpenChange={setSettingsOpen}
        template={template} onSave={save}
        sampleCode={labelItems[0]?.code ?? "STK-000001"}
        sampleEdition={labelItems[0]?.edition ?? "001/100"}
      />
      <QrLabelPreviewDialog
        open={previewOpen} onOpenChange={setPreviewOpen}
        template={template} items={labelItems}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("전체 라벨을 인쇄하시겠습니까?", "确定打印全部标签吗？")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <p>{tr("주문번호", "订单号")}: {orderNo}</p>
                <p>{tr("총 라벨수", "标签总数")}: {counts.total}</p>
                <p>{tr("시작", "起始")}: {labelItems[0]?.edition ?? "-"} · {tr("마지막", "结束")}: {labelItems[labelItems.length - 1]?.edition ?? "-"}</p>
                <p>{tr("프린터", "打印机")}: {template.printer_display_name}</p>
                <p>{tr("라벨", "标签")}: {template.label_width} × {template.label_height}mm · {template.columns}{tr("열", "列")}</p>
                <p>{tr("예상 출력 폭", "预计打印宽")}: {width.requiredMm}mm / {tr("프린터 최대 폭", "打印机最大宽")}: {width.maxMm}mm</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("취소", "取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runPrint(labelItems, template)}>
              {tr(`${counts.total}장 인쇄`, `打印 ${counts.total} 张`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reprintTarget !== null} onOpenChange={(v) => !v && setReprintTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("이미 출력된 라벨입니다. 다시 출력하시겠습니까?", "该标签已打印，确定重新打印吗？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {labelItems.find((i) => i.position === reprintTarget)?.code}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("취소", "取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const p = reprintTarget; setReprintTarget(null); if (p) void doReprint(p); }}>
              {tr("재인쇄", "重打")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

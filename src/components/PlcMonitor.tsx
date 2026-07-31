import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gauge, Activity, AlertTriangle, Play, Square, RotateCcw, Wifi, WifiOff, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { toast } from "sonner";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// 현장 PLC 매핑 (문서 기준: plc0, plc1 사용)
const MACHINES = [
  { plcId: "plc0", label: "88", nameKo: "티셔츠 포장기 (세트포장)", nameZh: "T恤包装机（套装包装）" },
  { plcId: "plc1", label: "99", nameKo: "카드 포장기", nameZh: "卡片包装机" },
];

type PlcStatus = {
  state: "running" | "stopped" | "fault" | "e_stop" | "unknown";
  running: boolean;
  target_count_reached: boolean;
  e_stop: boolean;
  faults: string[];
  total_count: number;
  packaged_length_m: number | null;
  operating_seconds: number;
  operating_duration: string;
  timestamp: string;
};

type PlcStatusResponse = PlcStatus | {
  offline: true;
  upstream_status: number;
};

async function proxyFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const s = await supabase.auth.getSession();
  const token = s.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${PROXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`, { ...init, headers });
}

function stateBadgeClass(state?: string) {
  switch (state) {
    case "running": return "bg-success text-success-foreground";
    case "stopped": return "bg-muted text-muted-foreground";
    case "fault":
    case "e_stop": return "bg-destructive text-destructive-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

function PlcCard({ plcId, label, name }: { plcId: string; label: string; name: string }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { data: orders } = useOrders();
  const [status, setStatus] = useState<PlcStatus | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [assignedAt, setAssignedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ctrlUnsupported, setCtrlUnsupported] = useState<Record<string, boolean>>({});


  const activeOrder = useMemo(
    () => (orders || []).find((o: any) => o.id === activeOrderId) || null,
    [orders, activeOrderId]
  );

  // Poll status
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await proxyFetch(`/api/v1/plc/${plcId}/status`);
        if (!alive) return;
        if (!res.ok) {
          setStatus(null);
          setOnline(false);
          setErrorMsg(isKo ? "PLC 연결 불가" : "PLC连接失败");
          return;
        }
        const j = (await res.json()) as PlcStatusResponse;
        if (!alive) return;
        if ("upstream_status" in j) {
          setStatus(null);
          setOnline(false);
          setErrorMsg(isKo ? "PLC 연결 불가" : "PLC连接失败");
          return;
        }
        setStatus(j);
        setOnline(true);
        setErrorMsg(null);
      } catch {
        if (!alive) return;
        setStatus(null);
        setOnline(false);
        setErrorMsg(isKo ? "네트워크 오류" : "网络错误");
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [plcId, isKo]);

  // Load active order assignment
  const loadAssignment = async () => {
    const { data } = await supabase
      .from("plc_active_orders")
      .select("order_id, assigned_at")
      .eq("plc_id", plcId)
      .maybeSingle();
    setActiveOrderId(data?.order_id ?? null);
    setPendingOrderId(data?.order_id ?? null);
    setAssignedAt(data?.assigned_at ?? null);
  };
  useEffect(() => { loadAssignment(); }, [plcId]);

  const assignOrder = async (orderId: string | null) => {
    setBusy(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload: any = {
        plc_id: plcId,
        plc_label: `${label} · ${name}`,
        order_id: orderId,
        assigned_by: user?.id ?? null,
        assigned_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("plc_active_orders")
        .upsert(payload, { onConflict: "plc_id" });
      if (error) throw error;

      // Reset PLC counter so counting starts from 0 for this order
      let resetOk = false;
      try {
        const res = await proxyFetch(`/api/v1/plc/${plcId}/control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: "reset_counter" }),
        });
        resetOk = res.ok;
      } catch { /* PLC offline — assignment still saved */ }

      await loadAssignment();
      toast.success(
        resetOk
          ? (isKo ? "저장되었습니다. 카운터를 초기화했습니다." : "已保存，计数器已重置。")
          : (isKo ? "저장되었습니다. (카운터 초기화 실패 — PLC 연결 확인)" : "已保存。（计数器重置失败 — 请检查PLC连接）")
      );
    } catch (e: any) {
      toast.error(e?.message || (isKo ? "지정 실패" : "指定失败"));
    } finally {
      setBusy(false);
    }
  };


  const clearAssignment = async () => {
    setBusy(true);
    try {
      await supabase.from("plc_active_orders").delete().eq("plc_id", plcId);
      await loadAssignment();
      toast.success(isKo ? "지정이 해제되었습니다" : "已解除指定");
    } finally {
      setBusy(false);
    }
  };

  const control = async (command: "start" | "stop" | "reset_counter") => {
    setBusy(true);
    try {
      const res = await proxyFetch(`/api/v1/plc/${plcId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      if (res.status === 501) {
        setCtrlUnsupported(prev => ({ ...prev, [command]: true }));
        toast.info(
          isKo
            ? "이 장비는 원격 제어(쓰기)가 지원되지 않습니다. 현장에서 조작해주세요. (모니터링 전용)"
            : "该设备不支持远程控制（写入），请在现场操作。（仅监控）"
        );
        return;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      toast.success(isKo ? `명령 전송: ${command}` : `命令已发送: ${command}`);
    } catch (e: any) {
      toast.error(e?.message || (isKo ? "명령 실패" : "命令失败"));
    } finally {
      setBusy(false);
    }
  };

  const stateLabels: Record<string, string> = {
    running: isKo ? "가동중" : "运行中",
    stopped: isKo ? "정지" : "停止",
    fault: isKo ? "오류" : "故障",
    e_stop: isKo ? "비상정지" : "急停",
    unknown: isKo ? "알수없음" : "未知",
  };

  const remaining = activeOrder && status
    ? Math.max(0, (activeOrder.quantity || 0) - (status.total_count || 0))
    : null;
  const progressPct = activeOrder && status
    ? Math.min(100, Math.round(((status.total_count || 0) / Math.max(1, activeOrder.quantity || 1)) * 100))
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="w-4 h-4 text-primary" />
            <span className="font-mono">{label}</span>
            <span className="text-muted-foreground font-normal">· {name}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {online ? (
              <Badge variant="outline" className="gap-1 text-[10px]"><Wifi className="w-3 h-3" />ON</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1 text-[10px]"><WifiOff className="w-3 h-3" />OFF</Badge>
            )}
            {status && (
              <Badge className={`text-[10px] ${stateBadgeClass(status.state)}`}>{stateLabels[status.state] || status.state}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active order */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
              <Package className="w-3.5 h-3.5" />
              {isKo ? "현재 작업 주문" : "当前作业订单"}
            </div>
            {activeOrder && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={clearAssignment} disabled={busy}>
                {isKo ? "해제" : "解除"}
              </Button>
            )}
          </div>
          {activeOrder ? (
            <div className="space-y-1">
              <div className="text-sm font-medium font-mono">{activeOrder.external_order_id}</div>
              <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                <span>{isKo ? "트윈커" : "Twinker"}: {activeOrder.recipient_name}</span>
                <span>{isKo ? "수량" : "数量"}: {activeOrder.quantity}</span>
                {activeOrder.product_code && <span>{isKo ? "상품" : "商品"}: {activeOrder.product_code}</span>}
              </div>
              {status && (
                <div className="pt-1">
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-muted-foreground">{isKo ? "진행률" : "进度"}</span>
                    <span className="tabular-nums font-medium">
                      {status.total_count} / {activeOrder.quantity}
                      <span className="text-muted-foreground ml-1">({progressPct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                  {remaining !== null && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {isKo ? "남은 수량" : "剩余"}: {remaining}
                    </div>
                  )}
                </div>
              )}
              {assignedAt && (
                <div className="text-[10px] text-muted-foreground">
                  {isKo ? "지정" : "指定"}: {new Date(assignedAt).toLocaleString(isKo ? "ko-KR" : "zh-CN")}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              {isKo ? "지정된 주문이 없습니다. 아래에서 선택하세요." : "尚未指定订单，请从下方选择。"}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Select value={pendingOrderId ?? undefined} onValueChange={setPendingOrderId} disabled={busy}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue placeholder={isKo ? "작업지시번호 선택…" : "选择工单号…"} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(orders || [])
                  .filter((o: any) => o.status !== "completed" && o.status !== "cancelled")
                  .map((o: any) => (
                    <SelectItem key={o.id} value={o.id} className="text-xs">
                      <span className="font-mono">{o.external_order_id}</span>
                      <span className="text-muted-foreground ml-2">· {o.recipient_name} · {o.quantity}{isKo ? "개" : "件"}</span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy || !pendingOrderId || pendingOrderId === activeOrderId}
              onClick={() => pendingOrderId && assignOrder(pendingOrderId)}
            >
              {isKo ? "저장" : "保存"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {isKo
              ? "저장 시 해당 주문 기준으로 카운터가 0부터 다시 집계됩니다."
              : "保存后计数器将以该订单为准从0重新统计。"}
          </p>
        </div>


        {/* Live metrics */}
        {errorMsg && !status && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {errorMsg}
          </div>
        )}
        {status && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">{status.total_count.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "누적 카운트" : "累计计数"}</p>
              </div>
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">
                  {status.packaged_length_m != null ? `${status.packaged_length_m.toFixed(1)}m` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "포장 길이" : "包装长度"}</p>
              </div>
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">{status.operating_duration}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "가동시간" : "运行时长"}</p>
              </div>
            </div>

            {(status.faults?.length > 0 || status.e_stop) && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                <div className="flex items-center gap-1.5 font-medium mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {status.e_stop ? (isKo ? "비상정지" : "急停") : (isKo ? "오류 감지" : "检测到故障")}
                </div>
                {status.faults?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {status.faults.map(f => (
                      <Badge key={f} variant="destructive" className="text-[10px]">{f}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => control("stop")} disabled={busy || !status.running || ctrlUnsupported["stop"]} title={ctrlUnsupported["stop"] ? (isKo ? "원격 제어 미지원 (모니터링 전용)" : "不支持远程控制（仅监控）") : undefined}>
                <Square className="w-3.5 h-3.5 mr-1" /> {isKo ? "정지" : "停止"}
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => control("reset_counter")} disabled={busy || ctrlUnsupported["reset_counter"]}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> {isKo ? "카운터 초기화" : "计数重置"}
              </Button>
            </div>
            {(ctrlUnsupported["stop"] || ctrlUnsupported["reset_counter"]) && (
              <p className="text-[10px] text-muted-foreground">
                {isKo
                  ? "이 장비는 게이트웨이에 제어용 레지스터가 등록되어 있지 않아 원격 제어가 불가합니다. 현재는 모니터링 전용입니다."
                  : "该设备未在网关登记控制寄存器，无法远程控制。当前仅支持监控。"}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function PlcMonitor() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity className="w-4 h-4" />
        {isKo
          ? "PLC 실시간 상태 · 2초 간격 폴링. 작업 시작 전 반드시 '현재 작업 주문'을 지정하세요."
          : "PLC实时状态 · 每2秒轮询。作业开始前请务必指定「当前作业订单」。"}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MACHINES.map(m => (
          <PlcCard key={m.plcId} plcId={m.plcId} label={m.label} name={isKo ? m.nameKo : m.nameZh} />
        ))}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanLine, RotateCcw, CheckCircle2, XCircle, Wifi, WifiOff, ShieldAlert } from "lucide-react";
import { STAGE_PLC } from "@/hooks/usePlcStatus";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function proxyFetch(path: string, init?: RequestInit) {
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
}

type ScanStatus = {
  count: number;
  last_barcode: string | null;
  last_duration: number | null;
  last_seen: string | null;
  connected: boolean;
};

type Verdict = "ok" | "order" | "mismatch" | "duplicate";

type LogRow = {
  at: string;
  barcode: string;
  verdict: Verdict;
  expected: string | null;
  position: number | null;
};

const norm = (v: string) => (v || "").trim().toUpperCase();

/** DM 바코드 스캐너 (카드 포장기) 모니터링 · 주문 순서 검수 */
export default function DmScannerMonitor() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [lastVerdict, setLastVerdict] = useState<Verdict | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>("");

  // 카드 포장기(plc1)에 지정된 주문을 기준으로 검수한다.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data: assign } = await supabase
        .from("plc_active_orders")
        .select("order_id")
        .eq("plc_id", STAGE_PLC.card.plcId)
        .maybeSingle();
      if (!alive) return;
      if (!assign?.order_id) { setOrder(null); return; }
      const { data: o } = await supabase
        .from("orders")
        .select("id, external_order_id, quantity, product_code, design_code, recipient_name, source_data")
        .eq("id", assign.order_id)
        .maybeSingle();
      if (alive) setOrder(o ?? null);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 주문 상세 항목 → 기대 순서 목록
  const expected = useMemo(() => {
    const src: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(src.length, order?.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = src[idx] || {};
      const no = (it.order_id as string) || (it.sequence_no as string) || `${idx + 1}`;
      return {
        position: idx + 1,
        no: String(no),
        // 카드 DM 바코드는 개별주문번호 또는 그 파생 고유번호(-1/-2/-3), QR 값 중 하나로 인쇄된다.
        keys: [String(no), `${no}-1`, `${no}-2`, `${no}-3`, it.qr_value, it.dm_code, it.barcode]
          .filter(Boolean)
          .map((v: string) => norm(v)),
      };
    });
  }, [order]);

  // 스캐너 상태 폴링
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await proxyFetch("/api/v1/scan/status");
        const j: any = await res.json();
        if (!alive) return;
        if (!res.ok || "upstream_status" in j) { setOffline(true); return; }
        setOffline(false);
        setStatus(j as ScanStatus);
      } catch {
        if (alive) setOffline(true);
      }
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 새 스캔 감지 → 자동 검수
  useEffect(() => {
    if (!status?.last_barcode) return;
    const key = `${status.last_seen ?? ""}|${status.last_barcode}|${status.count}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    const code = norm(status.last_barcode);
    let verdict: Verdict = "mismatch";
    let position: number | null = null;
    const target = expected[cursor];

    if (seenRef.current.has(code)) {
      verdict = "duplicate";
      position = expected.findIndex((e) => e.keys.includes(code)) + 1 || null;
    } else if (target && target.keys.includes(code)) {
      verdict = "ok";
      position = target.position;
      seenRef.current.add(code);
      setCursor((c) => c + 1);
    } else {
      const found = expected.findIndex((e) => e.keys.includes(code));
      if (found >= 0) { verdict = "order"; position = found + 1; }
    }

    setLastVerdict(verdict);
    setLog((prev) => [
      {
        at: status.last_seen ?? new Date().toISOString(),
        barcode: status.last_barcode as string,
        verdict,
        expected: target?.no ?? null,
        position,
      },
      ...prev,
    ].slice(0, 100));
  }, [status, expected, cursor]);

  const resetScanner = async () => {
    await proxyFetch("/api/v1/scan/reset", { method: "POST", body: "{}" }).catch(() => null);
    seenRef.current = new Set();
    setCursor(0);
    setLog([]);
    setLastVerdict(null);
    lastKeyRef.current = "";
  };

  const total = expected.length;
  const verdictMeta: Record<Verdict, { ko: string; zh: string; cls: string }> = {
    ok: { ko: "일치", zh: "匹配", cls: "text-emerald-500" },
    order: { ko: "순서 오류", zh: "顺序错误", cls: "text-destructive" },
    mismatch: { ko: "불일치", zh: "不匹配", cls: "text-destructive" },
    duplicate: { ko: "중복 스캔", zh: "重复扫描", cls: "text-destructive" },
  };

  const lampOk = lastVerdict === "ok";
  const lampBad = lastVerdict != null && lastVerdict !== "ok";

  return (
    <div className="space-y-6">
      {/* 장비 상태 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ScanLine className="w-4 h-4" />
              {tr("카드 DM 바코드 스캐너", "卡片DM条码扫描仪")}
            </span>
            <span className="flex items-center gap-2">
              {offline || !status?.connected ? (
                <Badge variant="outline" className="gap-1 text-destructive border-destructive/40">
                  <WifiOff className="w-3 h-3" />{tr("연결 끊김", "连接断开")}
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40">
                  <Wifi className="w-3 h-3" />{tr("연결됨", "已连接")}
                </Badge>
              )}
              <Button size="sm" variant="outline" className="gap-1" onClick={resetScanner}>
                <RotateCcw className="w-3.5 h-3.5" />{tr("카운터 초기화", "计数复位")}
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
          {/* 경고등 */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2">
              <span
                className={`w-8 h-8 rounded-full border transition-all ${lampOk ? "bg-emerald-500 shadow-[0_0_18px_hsl(var(--primary)/0.6)]" : "bg-muted"}`}
              />
              <span
                className={`w-8 h-8 rounded-full border transition-all ${lampBad ? "bg-destructive shadow-[0_0_18px_hsl(var(--destructive)/0.6)]" : "bg-muted"}`}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">{tr("경고등", "警示灯")}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{status?.count ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">{tr("스캐너 누적 카운트", "扫描累计计数")}</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">
              {cursor}
              <span className="text-sm text-muted-foreground"> / {total || "-"}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">{tr("검수 통과 수량", "检验通过数量")}</p>
          </div>
          <div>
            <p className="text-sm font-mono break-all">{status?.last_barcode ?? "-"}</p>
            <p className="text-[11px] text-muted-foreground">{tr("최근 바코드", "最近条码")}</p>
          </div>
          <div>
            <p className="text-sm tabular-nums">
              {status?.last_seen ? new Date(status.last_seen).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN") : "-"}
              {status?.last_duration != null && <span className="text-muted-foreground"> · {status.last_duration}s</span>}
            </p>
            <p className="text-[11px] text-muted-foreground">{tr("최근 스캔 시각", "最近扫描时间")}</p>
          </div>
        </CardContent>
      </Card>

      {/* 검수 대상 주문 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {tr("검수 대상 주문", "检验对象订单")}
            <span className="text-xs font-normal text-muted-foreground">
              · {STAGE_PLC.card.label} {isKo ? STAGE_PLC.card.nameKo : STAGE_PLC.card.nameZh}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!order ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              <ShieldAlert className="w-5 h-5 mx-auto mb-2 opacity-40" />
              {tr("장비 상태 탭에서 카드 포장기에 주문을 지정하면 자동 검수가 시작됩니다", "在设备状态标签为卡片包装机指定订单后将自动开始检验")}
            </div>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("작업지시번호", "工单号")}</span><span className="font-mono">{order.external_order_id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("수량", "数量")}</span><span className="tabular-nums">{order.quantity}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("상품코드", "商品代码")}</span><span>{order.product_code}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{tr("다음 대상", "下一目标")}</span><span className="font-mono">{expected[cursor]?.no ?? "-"}</span></div>
              </div>
              <div className="h-2 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${total ? Math.min(100, (cursor / total) * 100) : 0}%` }} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 스캔 로그 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tr("스캔 검수 로그", "扫描检验日志")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-2 py-1.5">{tr("시간", "时间")}</th>
                  <th className="px-2 py-1.5">{tr("스캔 값", "扫描值")}</th>
                  <th className="px-2 py-1.5">{tr("순번", "序号")}</th>
                  <th className="px-2 py-1.5">{tr("기대 값", "期望值")}</th>
                  <th className="px-2 py-1.5">{tr("판정", "判定")}</th>
                </tr>
              </thead>
              <tbody>
                {log.length === 0 ? (
                  <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">{tr("스캔 데이터가 없습니다", "暂无扫描数据")}</td></tr>
                ) : log.map((r, i) => (
                  <tr key={i} className={`border-t ${r.verdict === "ok" ? "" : "bg-destructive/5"}`}>
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{new Date(r.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}</td>
                    <td className="px-2 py-1.5 font-mono">{r.barcode}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.position ?? "-"}</td>
                    <td className="px-2 py-1.5 font-mono">{r.expected ?? "-"}</td>
                    <td className={`px-2 py-1.5 font-medium ${verdictMeta[r.verdict].cls}`}>
                      <span className="inline-flex items-center gap-1">
                        {r.verdict === "ok" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {isKo ? verdictMeta[r.verdict].ko : verdictMeta[r.verdict].zh}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

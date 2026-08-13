import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gauge, Activity, AlertTriangle, Wifi, WifiOff, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";

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

type PlcStatusResponse = PlcStatus | { offline: true; upstream_status: number };

async function proxyFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const s = await supabase.auth.getSession();
  const token = s.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${PROXY_BASE}${path.startsWith("/") ? "" : "/"}${path}`, { ...init, headers });
}

// 게이트웨이의 32비트 카운터 워드 순서(word order) 오류 보정.
const WORD_SHIFT = 65536;
function normalizeCount(raw?: number | null): number {
  const v = Number(raw ?? 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v >= WORD_SHIFT && v % WORD_SHIFT === 0 ? v / WORD_SHIFT : v;
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

function BoolRow({ label, value, invert }: { label: string; value: boolean; invert?: boolean }) {
  const bad = invert ? value : false;
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1 font-medium ${bad ? "text-destructive" : value ? "text-success" : "text-muted-foreground"}`}>
        {value ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
        {value ? "YES" : "NO"}
      </span>
    </div>
  );
}

function PlcCard({ plcId, label, name, profile }: { plcId: string; label: string; name: string; profile?: string }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const [status, setStatus] = useState<PlcStatus | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // API 문서 기준: belt_cutter 프로파일은 카운터 레지스터가 없어 total_count/포장길이가 항상 0.
  const noCounter = profile === "belt_cutter";


  useEffect(() => {
    let alive = true;
    let delay = 2000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let ok = false;
      try {
        const res = await proxyFetch(`/api/v1/plc/${plcId}/status`);
        if (!alive) return;
        if (!res.ok) {
          setStatus(null); setOnline(false);
          setErrorMsg(isKo ? "PLC 연결 불가" : "PLC连接失败");
        } else {
          const j = (await res.json()) as PlcStatusResponse;
          if (!alive) return;
          if ("upstream_status" in j) {
            setStatus(null); setOnline(false);
            setErrorMsg(isKo ? "PLC 연결 불가" : "PLC连接失败");
          } else {
            ok = true;
            setStatus(j); setOnline(true); setErrorMsg(null);
          }
        }
      } catch {
        if (!alive) return;
        setStatus(null); setOnline(false);
        setErrorMsg(isKo ? "네트워크 오류" : "网络错误");
      }
      if (!alive) return;
      delay = ok ? 2000 : Math.min(delay * 2, 60000);
      timer = setTimeout(tick, delay);
    };
    void tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [plcId, isKo]);

  const stateLabels: Record<string, string> = {
    running: isKo ? "가동중" : "运行中",
    stopped: isKo ? "정지" : "停止",
    fault: isKo ? "오류" : "故障",
    e_stop: isKo ? "비상정지" : "急停",
    unknown: isKo ? "알수없음" : "未知",
  };

  const totalCount = normalizeCount(status?.total_count);

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
        {errorMsg && !status && (
          <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {errorMsg}
          </div>
        )}

        {status && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">{totalCount.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "누적 카운트" : "累计计数"}</p>
              </div>
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">
                  {status.packaged_length_m != null ? `${status.packaged_length_m.toFixed(1)}m` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "포장 길이" : "包装长度"}</p>
              </div>
              <div className="kpi-card text-center py-3">
                <p className="text-xl font-semibold tabular-nums">{status.operating_duration || "—"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{isKo ? "가동시간" : "运行时长"}</p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 px-3 py-1">
              <BoolRow label={isKo ? "가동 여부" : "是否运行"} value={status.running} />
              <BoolRow label={isKo ? "목표 수량 도달" : "达到目标数量"} value={status.target_count_reached} />
              <BoolRow label={isKo ? "비상정지" : "急停"} value={status.e_stop} invert />
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-muted-foreground">{isKo ? "가동 시간(초)" : "运行秒数"}</span>
                <span className="font-medium tabular-nums">{Number(status.operating_seconds ?? 0).toLocaleString()}</span>
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

            {status.timestamp && (
              <p className="text-[10px] text-muted-foreground text-right">
                {isKo ? "수신" : "接收"}: {new Date(status.timestamp).toLocaleString(isKo ? "ko-KR" : "zh-CN")}
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
          ? "PLC 실시간 상태 · 2초 간격 폴링. (모니터링 전용)"
          : "PLC实时状态 · 每2秒轮询。（仅监控）"}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {MACHINES.map(m => (
          <PlcCard key={m.plcId} plcId={m.plcId} label={m.label} name={isKo ? m.nameKo : m.nameZh} />
        ))}
      </div>
    </div>
  );
}

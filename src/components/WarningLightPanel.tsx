import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, RefreshCw, Wifi, WifiOff } from "lucide-react";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function proxyFetch(path: string, init?: RequestInit) {
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

type ChannelMode = "off" | "on" | "blink" | "unknown";
type ChannelState = { mode: ChannelMode; blink_level: number | null };
type LightStatus = Record<string, ChannelState | number | string | null>;

const CHANNELS = [
  { key: "red", ko: "빨강", zh: "红色", dot: "bg-destructive" },
  { key: "green", ko: "초록", zh: "绿色", dot: "bg-emerald-500" },
] as const;

/**
 * USB Modbus-RTU 경고등 제어 패널.
 * GET /api/v1/warning-light/status 로 상태를 폴링하고,
 * POST /api/v1/warning-light/control 로 채널별 off/on/점멸을 지정한다.
 */
export default function WarningLightPanel() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const { toast } = useToast();

  const [status, setStatus] = useState<LightStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [levels, setLevels] = useState<Record<string, string>>({ red: "3", green: "3" });

  // 게이트웨이(터널)가 순간적으로 503을 돌려주는 일이 잦아, 단발성 실패로는
  // "연결 끊김"으로 표시하지 않고 연속 실패 3회부터 오프라인으로 판정한다.
  const failRef = useRef(0);

  const load = useCallback(async () => {
    const tryOnce = async () => {
      const res = await proxyFetch("/api/v1/warning-light/status");
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || "upstream_status" in (j ?? {})) return null;
      return j as LightStatus;
    };
    try {
      let j = await tryOnce();
      if (!j) {
        await new Promise((r) => setTimeout(r, 600));
        j = await tryOnce();
      }
      if (!j) {
        failRef.current += 1;
        if (failRef.current >= 3) setOffline(true);
        return;
      }
      failRef.current = 0;
      setOffline(false);
      setStatus(j);
    } catch {
      failRef.current += 1;
      if (failRef.current >= 3) setOffline(true);
    }
  }, []);


  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  const control = useCallback(async (channel: string, mode: "off" | "on" | "blink") => {
    setBusy(true);
    const value: Record<string, unknown> = { mode };
    const level = Number(levels[channel] ?? 3);
    if (mode === "blink") value.blink_level = level;
    // 낙관적 갱신: 장치 응답/폴링을 기다리지 않고 UI를 먼저 반영한다.
    setStatus((p) => ({ ...(p ?? {}), [channel]: { mode, blink_level: mode === "blink" ? level : null } }));
    try {
      // 게이트웨이가 일시적으로 503(offline)을 반환하는 경우가 있어 짧게 재시도한다.
      let j: any = {};
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await proxyFetch("/api/v1/warning-light/control", {
          method: "POST",
          body: JSON.stringify({ [channel]: value }),
        });
        j = await res.json().catch(() => ({}));
        if (res.ok && j?.accepted) break;
        const transient = j?.offline === true || j?.upstream_status === 503 || res.status === 503;
        if (!transient) break;
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
      if (!res?.ok || !j?.accepted) {
        const detail = j?.detail;
        const msg = j?.offline
          ? tr("게이트웨이/경고등 장치가 응답하지 않습니다 (503).", "网关/警示灯设备无响应 (503)。")
          : typeof detail === "string"
            ? detail
            : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(", ") : `HTTP ${res?.status ?? "-"}`;
        toast({ title: tr("1번 경고등 제어 실패", "1号警示灯控制失败"), description: msg, variant: "destructive" });
        load();
      } else {
        toast({ title: tr("1번 경고등 명령 전송됨", "已发送1号警示灯命令") });
        // 장치가 점멸 사이클을 끝낸 뒤 값을 적용하므로 짧게 여러 번 재조회한다.
        [400, 1200, 2500].forEach((ms) => setTimeout(() => void load(), ms));
      }

    } catch (e) {
      toast({ title: tr("1번 경고등 제어 실패", "1号警示灯控制失败"), description: String(e), variant: "destructive" });
      load();
    } finally {
      setBusy(false);
    }
  }, [levels, load, toast, isKo]);


  const modeLabel = (m?: ChannelMode) =>
    m === "on" ? tr("켜짐", "常亮")
      : m === "blink" ? tr("점멸", "闪烁")
        : m === "off" ? tr("꺼짐", "关闭")
          : tr("알 수 없음", "未知");

  return (
    <Card className={offline ? "border-destructive" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />{tr("1번 경고등 제어", "1号警示灯控制")}
          </span>
          <span className="flex items-center gap-2">
            {offline ? (
              <Badge variant="outline" className="gap-1 text-destructive border-destructive/40">
                <WifiOff className="w-3 h-3" />{tr("연결 끊김", "连接断开")}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40">
                <Wifi className="w-3 h-3" />{tr("연결됨", "已连接")}
              </Badge>
            )}
            <Button size="sm" variant="outline" className="gap-1" onClick={() => void load()}>
              <RefreshCw className="w-3.5 h-3.5" />{tr("새로고침", "刷新")}
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {CHANNELS.map((c) => {
          const st = (status?.[c.key] as ChannelState | undefined) ?? undefined;
          const on = st?.mode === "on";
          const blink = st?.mode === "blink";
          return (
            <div key={c.key} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <span
                className={`w-8 h-8 rounded-full border shrink-0 ${on || blink ? c.dot : "bg-muted"} ${blink ? "animate-pulse" : ""}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{isKo ? c.ko : c.zh}</p>
                <p className="text-[11px] text-muted-foreground">
                  {modeLabel(st?.mode)}
                  {st?.blink_level != null && ` · ${tr("주기", "周期")} ${st.blink_level}`}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <Select value={levels[c.key] ?? "3"} onValueChange={(v) => setLevels((p) => ({ ...p, [c.key]: v }))}>
                  <SelectTrigger className="w-[110px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>{tr("점멸", "闪烁")} {n} ({(n / 10).toFixed(1)}s)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void control(c.key, "on")}>
                  {tr("켜기", "开")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void control(c.key, "blink")}>
                  {tr("점멸", "闪烁")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void control(c.key, "off")}>
                  {tr("끄기", "关")}
                </Button>
              </div>
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          {tr(
            "장치가 소프트웨어 제어 모드일 때만 명령이 반영됩니다. IO 제어(잠금) 모드에서는 응답은 정상이어도 실제 동작하지 않습니다.",
            "仅当设备处于软件控制模式时命令才生效。IO控制（锁定）模式下即使返回正常也不会实际动作。",
          )}
        </p>
      </CardContent>
    </Card>
  );
}

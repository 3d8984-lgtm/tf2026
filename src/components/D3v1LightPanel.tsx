import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

type Mode = "off" | "on" | "blink" | "unknown";
type Status = Record<string, { mode: Mode } | string | null>;

const CHANNELS = [
  { key: "red", ko: "빨강", zh: "红色", dot: "bg-destructive" },
  { key: "yellow", ko: "노랑", zh: "黄色", dot: "bg-amber-400" },
  { key: "green", ko: "초록", zh: "绿色", dot: "bg-emerald-500" },
  { key: "buzzer", ko: "부저", zh: "蜂鸣器", dot: "bg-sky-500" },
] as const;

/**
 * 2번 경고등(USB_D3V1) 제어 패널 — /api/v2/d3v1-light/*.
 * 3색 + 부저, 점멸 속도 조절 없음(off/on/blink만).
 */
export default function D3v1LightPanel() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const { toast } = useToast();

  const [status, setStatus] = useState<Status | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const failRef = useRef(0);

  const load = useCallback(async () => {
    const tryOnce = async () => {
      const res = await proxyFetch("/api/v2/d3v1-light/status");
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || "upstream_status" in (j ?? {})) return null;
      return j as Status;
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
    setStatus((p) => ({ ...(p ?? {}), [channel]: { mode } }));
    try {
      let j: any = {};
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await proxyFetch("/api/v2/d3v1-light/control", {
          method: "POST",
          body: JSON.stringify({ [channel]: { mode } }),
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
        toast({ title: tr("2번 경고등 제어 실패", "2号警示灯控制失败"), description: msg, variant: "destructive" });
        load();
      } else {
        toast({ title: tr("2번 경고등 명령 전송됨", "已发送2号警示灯命令") });
        [400, 1200, 2500].forEach((ms) => setTimeout(() => void load(), ms));
      }
    } catch (e) {
      toast({ title: tr("2번 경고등 제어 실패", "2号警示灯控制失败"), description: String(e), variant: "destructive" });
      load();
    } finally {
      setBusy(false);
    }
  }, [load, toast, isKo]);

  const modeLabel = (m?: Mode) =>
    m === "on" ? tr("켜짐", "常亮")
      : m === "blink" ? tr("점멸", "闪烁")
        : m === "off" ? tr("꺼짐", "关闭")
          : tr("알 수 없음", "未知");

  return (
    <Card className={offline ? "border-destructive" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4" />
            {tr("2번 경고등 제어 (3색+부저)", "2号警示灯控制 (三色+蜂鸣器)")}
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
        <p className="text-[11px] text-muted-foreground">
          {tr("점멸 속도 조절은 지원하지 않습니다 (꺼짐/켜짐/점멸).", "不支持闪烁速度调节（关闭/常亮/闪烁）。")}
        </p>
        {CHANNELS.map((c) => {
          const st = (status?.[c.key] as { mode: Mode } | undefined) ?? undefined;
          const on = st?.mode === "on";
          const blink = st?.mode === "blink";
          return (
            <div key={c.key} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <span
                className={`w-8 h-8 rounded-full border shrink-0 ${on || blink ? c.dot : "bg-muted"} ${blink ? "animate-pulse" : ""}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{isKo ? c.ko : c.zh}</p>
                <p className="text-[11px] text-muted-foreground">{modeLabel(st?.mode)}</p>
              </div>
              <div className="flex items-center gap-2 ml-auto">
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
      </CardContent>
    </Card>
  );
}

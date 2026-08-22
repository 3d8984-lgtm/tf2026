import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";
import { Printer, Wifi, WifiOff } from "lucide-react";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function proxyFetch(path: string, init?: RequestInit) {
  return fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

const errText = (j: any, status: number) => {
  const d = j?.detail;
  return typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join(", ") : `HTTP ${status}`;
};

/** PF 신형 프린터(/api/v2/pf-printer) 잉크·버퍼 상태 표시 + 테스트 인쇄. */
export default function PfPrinterCard({ defaultText = "" }: { defaultText?: string }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [ink, setInk] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await proxyFetch("/api/v2/pf-printer/status");
        const j: any = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || "upstream_status" in (j ?? {})) { setOffline(true); return; }
        setOffline(false);
        setInk(typeof j?.ink_percent === "number" ? j.ink_percent : null);
        setBuffer(typeof j?.buffer_count === "number" ? j.buffer_count : null);
      } catch {
        if (alive) setOffline(true);
      }
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const testPrint = useCallback(async () => {
    const payload = text.trim().slice(0, 200);
    if (!payload) { toast.error(tr("인쇄할 값을 입력하세요", "请输入要打印的值")); return; }
    setBusy(true);
    try {
      const res = await proxyFetch("/api/v2/pf-printer/test", {
        method: "POST",
        body: JSON.stringify({ text: payload }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j?.accepted) toast.success(`${tr("PF 프린터로 전송했습니다", "已发送到PF打印机")} · ${payload}`);
      else toast.error(`${tr("PF 프린터 전송 실패", "PF打印机发送失败")} — ${errText(j, res.status)}`);
    } catch (e) {
      toast.error(`${tr("PF 프린터 전송 실패", "PF打印机发送失败")} — ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [text, isKo]);

  return (
    <Card className={offline ? "border-destructive" : ""}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-4">
          <Printer className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{tr("PF 신형 프린터", "PF新型打印机")}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {tr("잉크", "墨量")} {ink != null ? `${ink}%` : "-"} · {tr("버퍼 대기", "缓冲等待")} {buffer ?? "-"}
            </p>
          </div>
          {offline ? (
            <Badge variant="outline" className="gap-1 text-destructive border-destructive/40 shrink-0">
              <WifiOff className="w-3 h-3" />{tr("연결 끊김", "连接断开")}
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-emerald-500 border-emerald-500/40 shrink-0">
              <Wifi className="w-3 h-3" />{tr("연결됨", "已连接")}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={tr("테스트 인쇄할 바코드 값", "测试打印的条码值")}
            className="h-8 text-xs font-mono"
          />
          <Button size="sm" disabled={busy} onClick={() => void testPrint()}>
            {tr("테스트 인쇄", "测试打印")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";
import { Printer, Wifi, WifiOff, Play, Square } from "lucide-react";
import { pfPrint, pfPrinterRun, pfPrinterStop, pfPrinterStatus } from "@/lib/pf-printer";

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
      const st = await pfPrinterStatus();
      if (!alive) return;
      setOffline(st.offline);
      setInk(st.ink_percent);
      setBuffer(st.buffer_count);
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const testPrint = useCallback(async () => {
    const payload = text.trim().slice(0, 200);
    if (!payload) { toast.error(tr("인쇄할 값을 입력하세요", "请输入要打印的值")); return; }
    setBusy(true);
    const r = await pfPrint(payload);
    setBusy(false);
    if (r.ok) toast.success(`${tr("PF 프린터로 전송했습니다", "已发送到PF打印机")} · ${payload}`);
    else toast.error(`${tr("PF 프린터 전송 실패", "PF打印机发送失败")} — ${r.error}`);
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
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={tr("Run 모드 전환 (인쇄는 Run 모드에서만 동작)", "切换到Run模式")}
            onClick={async () => {
              const r = await pfPrinterRun();
              r.ok ? toast.success(tr("Run 모드로 전환했습니다", "已切换到Run模式"))
                   : toast.error(`${tr("Run 전환 실패", "切换失败")} — ${r.error}`);
            }}
          >
            <Play className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={tr("Stop 모드 전환", "切换到Stop模式")}
            onClick={async () => {
              const r = await pfPrinterStop();
              r.ok ? toast.success(tr("Stop 모드로 전환했습니다", "已切换到Stop模式"))
                   : toast.error(`${tr("Stop 전환 실패", "切换失败")} — ${r.error}`);
            }}
          >
            <Square className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

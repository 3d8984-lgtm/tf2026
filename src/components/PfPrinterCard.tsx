import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";
import { Printer, Wifi, WifiOff, Play, Square, Eraser, Loader2, Trash2 } from "lucide-react";
import { pfPrint, pfPrinterRun, pfPrinterStop, pfPrinterStatus, pfPrinterQueue, pfPrinterQueueClear, pfPrinterBufferClear } from "@/lib/pf-printer";


/** PF 시리즈 잉크젯 프린터(/api/v1/pf-printer) 잉크·버퍼 상태 표시 + 테스트 인쇄. */
export default function PfPrinterCard({ defaultText = "" }: { defaultText?: string }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [ink, setInk] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);
  // 첫 응답 전에는 상태를 알 수 없으므로 "확인 중" 으로 표시한다.
  const [probed, setProbed] = useState(false);
  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [st, q] = await Promise.all([pfPrinterStatus(), pfPrinterQueue()]);
      if (!alive) return;
      setOffline(st.offline && q.offline);
      setInk(st.ink_percent);
      setBuffer(st.buffer_count);
      setPending(q.offline ? null : q.pendingCount);
      setProbed(true);
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
    if (r.ok) {
      const note = r.printed
        ? tr("인쇄 완료 확인됨", "已确认打印完成")
        : tr("전송 성공 · 완료 응답 미확인", "发送成功 · 未确认完成");
      toast.success(`${tr("PF 프린터로 전송했습니다", "已发送到PF打印机")} · ${payload} · ${note}`);
    } else toast.error(`${tr("PF 프린터 전송 실패", "PF打印机发送失败")} — ${r.error}`);
  }, [text, isKo]);


  return (
    <Card className={probed && offline ? "border-destructive" : ""}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-4">
          <Printer className="w-5 h-5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{tr("PF 프린터", "PF新型打印机")}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {tr("잉크", "墨量")} {ink != null ? `${ink}%` : "-"} · {tr("버퍼 대기", "缓冲等待")} {buffer ?? "-"} · {tr("서버 대기열", "服务器队列")} {pending ?? "-"}
            </p>

          </div>
          {!probed ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />{tr("확인 중", "检查中")}
            </Badge>
          ) : offline ? (
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
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            title={tr("대기 중인 인쇄 요청 취소 (처리 중 1건은 유지)", "取消等待中的打印请求（处理中的1项保留）")}
            onClick={async () => {
              const r = await pfPrinterQueueClear();
              r.ok ? toast.success(`${tr("대기열을 비웠습니다", "已清空队列")} · ${r.cleared}`)
                   : toast.error(`${tr("대기열 초기화 실패", "清空队列失败")} — ${r.error}`);
            }}
          >
            <Eraser className="w-3.5 h-3.5" />
          </Button>


        </div>
      </CardContent>
    </Card>
  );
}

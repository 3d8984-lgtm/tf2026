import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Printer, Plug, Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useToast } from "@/hooks/use-toast";
import { useGlobalSetting } from "@/hooks/useGlobalSetting";
import {
  DEFAULT_PRINT_AGENT, PRINT_AGENT_SETTING_KEY, agentHealth, agentPrint,
  type PrintAgentConfig,
} from "@/lib/print-agent";

export default function PrintAgentSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const { toast } = useToast();

  const { value, setValue, persist } = useGlobalSetting<PrintAgentConfig>(
    PRINT_AGENT_SETTING_KEY,
    DEFAULT_PRINT_AGENT,
  );
  const cfg = { ...DEFAULT_PRINT_AGENT, ...(value ?? {}) };
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const patch = (p: Partial<PrintAgentConfig>) => setValue({ ...cfg, ...p });

  const save = async (next?: Partial<PrintAgentConfig>) => {
    setSaving(true);
    try {
      await persist({ ...cfg, ...(next ?? {}) });
      toast({ title: tr("저장되었습니다", "已保存") });
    } catch (e) {
      toast({ variant: "destructive", title: tr("저장 실패", "保存失败"), description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const h = await agentHealth(cfg);
      setPrinters(h.printers ?? []);
      const sumatraOk = Boolean(h.sumatra);
      setStatus({
        ok: sumatraOk,
        msg: sumatraOk
          ? tr(`연결됨 · 프린터 ${h.printers?.length ?? 0}대 인식`, `已连接 · 识别到 ${h.printers?.length ?? 0} 台打印机`)
          : tr("연결됐지만 SumatraPDF를 찾지 못했습니다 (.env SUMATRA_PATH 확인)",
                "已连接，但未找到 SumatraPDF（请检查 .env 的 SUMATRA_PATH）"),
      });
    } catch (e) {
      setStatus({
        ok: false,
        msg: tr(
          `연결 실패: ${String(e)} · 에이전트가 실행 중인지, 주소/포트가 맞는지 확인하세요.`,
          `连接失败：${String(e)} · 请确认代理已运行且地址/端口正确。`,
        ),
      });
    } finally {
      setTesting(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    const r = await agentPrint(cfg, { url: "https://www.orimi.com/pdf-test.pdf", jobId: `test-${Date.now()}` });
    setTesting(false);
    toast({
      variant: r.ok ? "default" : "destructive",
      title: r.ok ? tr("테스트 인쇄 전송됨", "测试打印已发送") : tr("테스트 인쇄 실패", "测试打印失败"),
      description: r.ok ? `${r.printer} · ${r.ms}ms` : r.error,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="h-4 w-4" />
          {tr("송장 프린트 에이전트", "运单打印代理")}
          {cfg.enabled && <Badge variant="secondary">{tr("사용 중", "启用中")}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {tr(
            "브라우저 인쇄를 거치지 않고 4PX 원본 PDF를 작업 PC의 라벨 프린터로 직접 보냅니다. 화질 저하와 인쇄 팝업이 사라집니다. 에이전트 설치 방법은 print-agent/README.md를 참고하세요. 에이전트가 응답하지 않으면 자동으로 기존 브라우저 인쇄로 폴백합니다.",
            "跳过浏览器打印，将4PX原始PDF直接发送到工作电脑的标签打印机，避免画质下降与打印弹窗。安装方法见 print-agent/README.md。代理无响应时自动回退到浏览器打印。",
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{tr("에이전트로 인쇄", "使用代理打印")}</p>
            <p className="text-xs text-muted-foreground">
              {tr("모든 계정·PC에 공유되는 설정입니다.", "该设置在所有账号与设备间共享。")}
            </p>
          </div>
          <Switch checked={cfg.enabled} onCheckedChange={(v) => { patch({ enabled: v }); void save({ enabled: v }); }} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("에이전트 주소", "代理地址")}</Label>
            <Input value={cfg.url} onChange={(e) => patch({ url: e.target.value })} placeholder="http://localhost:17777" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{tr("인증 토큰", "认证令牌")}</Label>
            <Input value={cfg.token} onChange={(e) => patch({ token: e.target.value })} placeholder="AGENT_TOKEN" autoComplete="new-password" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">{tr("프린터 이름", "打印机名称")}</Label>
            <Input
              value={cfg.printer}
              onChange={(e) => patch({ printer: e.target.value })}
              placeholder="APT04-A"
              list="print-agent-printers"
            />
            <datalist id="print-agent-printers">
              {printers.map((p) => <option key={p} value={p} />)}
            </datalist>
            {printers.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {tr("인식된 프린터", "已识别打印机")}: {printers.join(", ")}
              </p>
            )}
          </div>
        </div>

        {status && (
          <p className={`text-xs ${status.ok ? "text-emerald-500" : "text-destructive"}`}>{status.msg}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            <span className="ml-1.5">{tr("연결 테스트", "连接测试")}</span>
          </Button>
          <Button variant="outline" onClick={testPrint} disabled={testing || !cfg.printer}>
            <Printer className="h-4 w-4 mr-1.5" />
            {tr("테스트 인쇄", "测试打印")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {tr("저장", "保存")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

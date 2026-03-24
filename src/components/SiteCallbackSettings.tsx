import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, TestTube, CheckCircle2, XCircle, Loader2, Copy, Check, Globe, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CallbackConfig {
  enabled: boolean;
  callbackUrl: string;
  authHeader: string;
  authValue: string;
  autoSync: boolean;
  syncEvents: {
    trackingNumber: boolean;
    statusChange: boolean;
    delivered: boolean;
  };
}

const defaultConfig: CallbackConfig = {
  enabled: false,
  callbackUrl: "",
  authHeader: "x-api-key",
  authValue: "",
  autoSync: false,
  syncEvents: {
    trackingNumber: true,
    statusChange: true,
    delivered: true,
  },
};

export default function SiteCallbackSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();
  const [config, setConfig] = useState<CallbackConfig>(defaultConfig);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
  const [copied, setCopied] = useState(false);

  const update = (partial: Partial<CallbackConfig>) => setConfig(prev => ({ ...prev, ...partial }));
  const updateEvents = (partial: Partial<CallbackConfig["syncEvents"]>) =>
    setConfig(prev => ({ ...prev, syncEvents: { ...prev.syncEvents, ...partial } }));

  const handleTest = () => {
    if (!config.callbackUrl) {
      toast({ title: isKo ? "오류" : "错误", description: isKo ? "콜백 URL을 입력해주세요" : "请输入回调URL", variant: "destructive" });
      return;
    }
    setTestStatus("testing");
    setTimeout(() => {
      setTestStatus(config.callbackUrl.startsWith("http") ? "success" : "fail");
    }, 1500);
  };

  const handleSave = () => {
    toast({ title: isKo ? "저장됨" : "已保存", description: isKo ? "A 사이트 회신 설정이 저장되었습니다" : "A站点回调设置已保存" });
  };

  const payloadExample = JSON.stringify({
    event: "tracking_update",
    order_id: "ORD-2024-001",
    external_order_id: "SITE-A-12345",
    tracking_number: "4PX1234567890",
    carrier: "4px",
    status: "shipped",
    shipped_at: "2024-01-15T10:30:00Z",
  }, null, 2);

  const copyPayload = () => {
    navigator.clipboard.writeText(payloadExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="section-enter space-y-6">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <ArrowUpRight className="w-5 h-5 text-primary" />
          {isKo ? "A 사이트 회신 설정" : "A站点回调设置"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {isKo
            ? "배송 정보가 변경되면 A 사이트로 자동 회신합니다. 송장 번호 발급, 배송 상태 변경, 배달 완료 시 알림을 전송합니다."
            : "配送信息变更时自动回调A站点。在运单号生成、配送状态变更、送达完成时发送通知。"}
        </p>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Globe className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-sm">{isKo ? "회신 기능 활성화" : "启用回调功能"}</p>
            <p className="text-xs text-muted-foreground">{isKo ? "활성화하면 이벤트 발생 시 A 사이트로 자동 전송됩니다" : "启用后事件发生时将自动发送到A站点"}</p>
          </div>
        </div>
        <Switch checked={config.enabled} onCheckedChange={v => update({ enabled: v })} />
      </div>

      {/* Callback URL & Auth */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{isKo ? "콜백 URL" : "回调URL"}</Label>
          <Input
            value={config.callbackUrl}
            onChange={e => update({ callbackUrl: e.target.value })}
            placeholder="https://site-a.example.com/api/callback"
          />
          <p className="text-xs text-muted-foreground">{isKo ? "A 사이트에서 데이터를 수신할 엔드포인트 URL" : "A站点接收数据的端点URL"}</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{isKo ? "인증 헤더명" : "认证头名称"}</Label>
            <Input
              value={config.authHeader}
              onChange={e => update({ authHeader: e.target.value })}
              placeholder="x-api-key"
            />
          </div>
          <div className="space-y-2">
            <Label>{isKo ? "인증 값" : "认证值"}</Label>
            <Input
              type="password"
              value={config.authValue}
              onChange={e => update({ authValue: e.target.value })}
              placeholder={isKo ? "A 사이트에서 발급받은 키" : "A站点提供的密钥"}
            />
          </div>
        </div>
      </div>

      {/* Sync Events */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          {isKo ? "회신 이벤트 설정" : "回调事件设置"}
        </h4>
        <div className="space-y-3">
          {[
            { key: "trackingNumber" as const, label: isKo ? "운송장 번호 발급 시" : "运单号生成时", desc: isKo ? "택배사에서 송장번호를 받으면 A 사이트로 전송" : "从快递公司获取运单号后发送到A站点" },
            { key: "statusChange" as const, label: isKo ? "배송 상태 변경 시" : "配送状态变更时", desc: isKo ? "배송 상태가 변경될 때마다 A 사이트로 전송" : "每次配送状态变更时发送到A站点" },
            { key: "delivered" as const, label: isKo ? "배달 완료 시" : "送达完成时", desc: isKo ? "최종 배달 완료 확인 시 A 사이트로 전송" : "最终确认送达时发送到A站点" },
          ].map(evt => (
            <div key={evt.key} className="flex items-center justify-between py-2 px-3 rounded-md border bg-muted/30">
              <div>
                <p className="text-sm font-medium">{evt.label}</p>
                <p className="text-xs text-muted-foreground">{evt.desc}</p>
              </div>
              <Switch checked={config.syncEvents[evt.key]} onCheckedChange={v => updateEvents({ [evt.key]: v })} />
            </div>
          ))}
        </div>
      </div>

      {/* Payload Example */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">{isKo ? "회신 페이로드 예시" : "回调Payload示例"}</h4>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={copyPayload}>
            {copied ? <><Check className="w-3 h-3" />{isKo ? "복사됨" : "已复制"}</> : <><Copy className="w-3 h-3" />{isKo ? "복사" : "复制"}</>}
          </Button>
        </div>
        <pre className="bg-muted/50 p-3 rounded-md text-xs font-mono overflow-x-auto">{payloadExample}</pre>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="gap-1.5">
          {isKo ? "설정 저장" : "保存设置"}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={handleTest} disabled={testStatus === "testing"}>
          {testStatus === "testing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
          {isKo ? "테스트 전송" : "测试发送"}
        </Button>
        {testStatus === "success" && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />{isKo ? "성공" : "成功"}</Badge>}
        {testStatus === "fail" && <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1"><XCircle className="w-3 h-3" />{isKo ? "실패" : "失败"}</Badge>}
      </div>
    </div>
  );
}

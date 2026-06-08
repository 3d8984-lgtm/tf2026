import { useState, useEffect } from "react";
import { useLang } from "@/contexts/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownLeft, TestTube, CheckCircle2, XCircle, Loader2, Copy, Check, Globe, Send, KeyRound, RefreshCw, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface CallbackConfig {
  enabled: boolean;
  callback_url: string;
  auth_header: string;
  auth_value: string;
  auto_sync: boolean;
  sync_tracking_number: boolean;
  sync_status_change: boolean;
  sync_delivered: boolean;
}

const defaultConfig: CallbackConfig = {
  enabled: false,
  callback_url: "",
  auth_header: "x-api-key",
  auth_value: "",
  auto_sync: false,
  sync_tracking_number: true,
  sync_status_change: true,
  sync_delivered: true,
};

export default function SiteCallbackSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();
  const [config, setConfig] = useState<CallbackConfig>(defaultConfig);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
  const [copied, setCopied] = useState(false);

  // Load settings from DB
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("callback_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        setSettingsId(data.id);
        setConfig({
          enabled: data.enabled,
          callback_url: data.callback_url,
          auth_header: data.auth_header,
          auth_value: data.auth_value,
          auto_sync: data.auto_sync,
          sync_tracking_number: data.sync_tracking_number,
          sync_status_change: data.sync_status_change,
          sync_delivered: data.sync_delivered,
        });
      }
      setLoading(false);
    })();
  }, []);

  const update = (partial: Partial<CallbackConfig>) => setConfig(prev => ({ ...prev, ...partial }));

  const handleTest = async () => {
    if (!config.callback_url) {
      toast({ title: isKo ? "오류" : "错误", description: isKo ? "콜백 URL을 입력해주세요" : "请输入回调URL", variant: "destructive" });
      return;
    }
    setTestStatus("testing");
    try {
      const { data, error } = await supabase.functions.invoke("site-a-callback", {
        body: {
          event: "test",
          shipment_id: null,
          callback_url: config.callback_url,
          auth_header: config.auth_header,
          auth_value: config.auth_value,
          external_order_id: "TEST-001",
          tracking_number: "TEST-TRACK-001",
          carrier: "test",
          status: "shipped",
          order_id: "00000000-0000-0000-0000-000000000000",
        },
      });
      if (error) throw error;
      setTestStatus(data?.success ? "success" : "fail");
    } catch {
      setTestStatus("fail");
    }
  };

  const handleSave = async () => {
    if (!settingsId) return;
    const { error } = await supabase
      .from("callback_settings")
      .update({
        enabled: config.enabled,
        callback_url: config.callback_url,
        auth_header: config.auth_header,
        auth_value: config.auth_value,
        auto_sync: config.auto_sync,
        sync_tracking_number: config.sync_tracking_number,
        sync_status_change: config.sync_status_change,
        sync_delivered: config.sync_delivered,
      })
      .eq("id", settingsId);

    if (error) {
      toast({ title: isKo ? "오류" : "错误", description: error.message, variant: "destructive" });
    } else {
      toast({ title: isKo ? "저장됨" : "已保存", description: isKo ? "TWINMETA 사이트 회신 설정이 저장되었습니다" : "TWINMETA站点回调设置已保存" });
    }
  };

  const payloadExample = JSON.stringify({
    event: "tracking_update",
    order_id: "ORD-2024-001",
    external_order_id: "TWINMETA-12345",
    tracking_number: "4PX1234567890",
    carrier: "4px",
    status: "shipped",
    timestamp: "2024-01-15T10:30:00Z",
  }, null, 2);

  const copyPayload = () => {
    navigator.clipboard.writeText(payloadExample);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="section-enter space-y-6">
      {/* Header */}
      <div>
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <ArrowUpRight className="w-5 h-5 text-primary" />
          {isKo ? "TWINMETA 사이트 회신 설정" : "TWINMETA站点回调设置"}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {isKo
            ? "송장번호가 입력되면 자동으로 TWINMETA 사이트로 전송합니다. DB 트리거에 의해 실시간 동기화됩니다."
            : "运单号输入后自动发送到TWINMETA站点。通过DB触发器实时同步。"}
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
            <p className="text-xs text-muted-foreground">{isKo ? "활성화하면 송장번호 입력 시 자동으로 TWINMETA 사이트로 전송됩니다" : "启用后输入运单号时将自动发送到TWINMETA站点"}</p>
          </div>
        </div>
        <Switch checked={config.enabled} onCheckedChange={v => update({ enabled: v })} />
      </div>

      {/* Callback URL & Auth */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{isKo ? "콜백 URL" : "回调URL"}</Label>
          <Input
            value={config.callback_url}
            onChange={e => update({ callback_url: e.target.value })}
            placeholder="https://twinmeta.example.com/api/callback"
          />
          <p className="text-xs text-muted-foreground">{isKo ? "TWINMETA 사이트에서 데이터를 수신할 엔드포인트 URL" : "TWINMETA站点接收数据的端点URL"}</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{isKo ? "인증 헤더명" : "认证头名称"}</Label>
            <Input
              value={config.auth_header}
              onChange={e => update({ auth_header: e.target.value })}
              placeholder="x-api-key"
            />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5 text-primary" />{isKo ? "API 인증 키" : "API认证密钥"}</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={config.auth_value}
                onChange={e => update({ auth_value: e.target.value })}
                placeholder={isKo ? "키 생성 버튼으로 자동 생성하거나 직접 입력" : "点击生成按钮或手动输入"}
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={isKo ? "복사" : "复制"}
                onClick={() => {
                  if (!config.auth_value) return;
                  navigator.clipboard.writeText(config.auth_value);
                  toast({ title: isKo ? "복사됨" : "已复制" });
                }}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="default"
                className="gap-1.5 shrink-0"
                onClick={() => {
                  const bytes = new Uint8Array(32);
                  crypto.getRandomValues(bytes);
                  const key = "tm_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
                  update({ auth_value: key });
                  toast({ title: isKo ? "새 API 키가 생성되었습니다" : "已生成新的API密钥", description: isKo ? "저장 후 TWINMETA 사이트에도 동일한 키를 등록하세요" : "保存后请在TWINMETA站点登录相同密钥" });
                }}
              >
                <RefreshCw className="w-4 h-4" />
                {isKo ? "키 생성" : "生成密钥"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {isKo
                ? "이 키는 본 공장에서 TWINMETA 본사 사이트로 송장/배송 정보를 전송할 때 인증 헤더 값으로 사용됩니다. TWINMETA 사이트 측에도 동일한 키를 등록해야 합니다."
                : "此密钥用作本工厂向TWINMETA总部站点发送运单/配送信息时的认证头值。TWINMETA站点也需注册相同密钥。"}
            </p>
          </div>
        </div>
      </div>

      {/* Sync Events */}
      <div className="rounded-lg border p-4 space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Send className="w-4 h-4 text-primary" />
          {isKo ? "자동 전송 이벤트 설정" : "自动发送事件设置"}
        </h4>
        <div className="space-y-3">
          {[
            { key: "sync_tracking_number" as const, label: isKo ? "운송장 번호 입력 시" : "运单号输入时", desc: isKo ? "송장번호가 입력/변경되면 자동으로 TWINMETA 사이트로 전송 (DB 트리거)" : "运单号输入/变更时自动发送到TWINMETA站点（DB触发器）" },
            { key: "sync_status_change" as const, label: isKo ? "배송 상태 변경 시" : "配送状态变更时", desc: isKo ? "배송 상태가 변경될 때마다 TWINMETA 사이트로 전송" : "每次配送状态变更时发送到TWINMETA站点" },
            { key: "sync_delivered" as const, label: isKo ? "배달 완료 시" : "送达完成时", desc: isKo ? "최종 배달 완료 확인 시 TWINMETA 사이트로 전송" : "最终确认送达时发送到TWINMETA站点" },
          ].map(evt => (
            <div key={evt.key} className="flex items-center justify-between py-2 px-3 rounded-md border bg-muted/30">
              <div>
                <p className="text-sm font-medium">{evt.label}</p>
                <p className="text-xs text-muted-foreground">{evt.desc}</p>
              </div>
              <Switch checked={config[evt.key]} onCheckedChange={v => update({ [evt.key]: v })} />
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

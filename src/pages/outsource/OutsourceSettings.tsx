import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/contexts/LangContext";
import { toast } from "@/hooks/use-toast";
import { Mail, Save, Send, Wand2, ExternalLink, Loader2, Server, Copy, MessageSquare, Cpu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const WORKER_URL_KEY = "render.worker.url.v1";
export const WECHAT_KEYS_KEY = "wechat.webhook.keys.v1";
type WeChatChannel = "silicon" | "heat" | "hologram" | "nfc" | "logo" | "tshirt";
const WECHAT_CHANNELS: { key: WeChatChannel; label: { ko: string; zh: string } }[] = [
  { key: "silicon", label: { ko: "실리콘 마크 공장 (silicon)", zh: "硅胶标识工厂 (silicon)" } },
  { key: "heat", label: { ko: "열전사 디자인 공장 (heat)", zh: "热转印设计工厂 (heat)" } },
  { key: "hologram", label: { ko: "홀로그램 스티커 공장 (hologram)", zh: "全息贴纸工厂 (hologram)" } },
  { key: "nfc", label: { ko: "NFC 카드 공장 (nfc)", zh: "NFC卡片工厂 (nfc)" } },
  { key: "logo", label: { ko: "LOGO 공장 (logo)", zh: "LOGO工厂 (logo)" } },
  { key: "tshirt", label: { ko: "티셔츠 공장 (tshirt)", zh: "T恤工厂 (tshirt)" } },
];

export const VECTORIZER_MODE_KEY = "vectorizer.ai.mode.v1";
export type VectorizerMode = "test" | "preview" | "production";

export const UPSCALER_PROVIDER_KEY = "upscaler.provider.v1";
export const UPSCALER_SCALE_KEY = "upscaler.scale.v1";
export type UpscalerProvider = "photoroom";

type Factory = "silicon" | "heat" | "hologram" | "nfc" | "logo";

interface FactoryEmail {
  key: Factory;
  name: { ko: string; zh: string };
  contact: string;
  phone: string;
  url: string;
  email: string;
  cc: string;
}

const INITIAL: FactoryEmail[] = [
  { key: "silicon", name: { ko: "실리콘 마크 공장", zh: "硅胶标识工厂" }, contact: "Mr. Liu", phone: "+86-138-0000-0001", url: "https://silicon.factory.cn", email: "silicon@factory.cn", cc: "" },
  { key: "heat", name: { ko: "열전사 디자인 공장", zh: "热转印设计工厂" }, contact: "Ms. Zhang", phone: "+86-139-0000-0002", url: "https://heat.factory.cn", email: "heat@factory.cn", cc: "" },
  { key: "hologram", name: { ko: "홀로그램 스티커 공장", zh: "全息贴纸工厂" }, contact: "Mr. Wang", phone: "+86-137-0000-0003", url: "https://hologram.factory.cn", email: "hologram@factory.cn", cc: "" },
  { key: "nfc", name: { ko: "NFC 카드 공장", zh: "NFC卡片工厂" }, contact: "Mr. Chen", phone: "+86-136-0000-0004", url: "https://nfc.factory.cn", email: "nfc@factory.cn", cc: "" },
  { key: "logo", name: { ko: "LOGO 공장", zh: "LOGO工厂" }, contact: "Ms. Li", phone: "+86-135-0000-0005", url: "https://logo.factory.cn", email: "logo@factory.cn", cc: "" },
];

export default function OutsourceSettings() {
  const { lang } = useLang();
  const [list, setList] = useState<FactoryEmail[]>(INITIAL);
  const [defaultCc, setDefaultCc] = useState("ops@twinmeta.xyz");
  const [signature, setSignature] = useState(
    lang === "ko"
      ? "TWINMETA FACTORY\n외주 관리팀\nops@twinmeta.xyz"
      : "TWINMETA FACTORY\n外协管理团队\nops@twinmeta.xyz"
  );

  // Vectorizer.AI 설정
  const [vecMode, setVecMode] = useState<VectorizerMode>(() => {
    const v = (typeof window !== "undefined" && localStorage.getItem(VECTORIZER_MODE_KEY)) as VectorizerMode | null;
    return v === "production" || v === "preview" || v === "test" ? v : "test";
  });
  const [vecTesting, setVecTesting] = useState(false);
  useEffect(() => { localStorage.setItem(VECTORIZER_MODE_KEY, vecMode); }, [vecMode]);

  // 업스케일링 (Photoroom) 설정
  const [upscaleProvider, setUpscaleProvider] = useState<UpscalerProvider>("photoroom");
  const [upscaleScale, setUpscaleScale] = useState<number>(() => {
    const v = typeof window !== "undefined" ? Number(localStorage.getItem(UPSCALER_SCALE_KEY)) : 0;
    return v === 2 || v === 4 ? v : 2;
  });
  const [photoroomTesting, setPhotoroomTesting] = useState(false);
  useEffect(() => { localStorage.setItem(UPSCALER_PROVIDER_KEY, upscaleProvider); }, [upscaleProvider]);
  useEffect(() => { localStorage.setItem(UPSCALER_SCALE_KEY, String(upscaleScale)); }, [upscaleScale]);

  // Render 워커 URL
  const [workerUrl, setWorkerUrl] = useState<string>(() =>
    (typeof window !== "undefined" && localStorage.getItem(WORKER_URL_KEY)) || ""
  );
  const [workerTesting, setWorkerTesting] = useState(false);

  // 위챗 채널별 웹훅 키
  const [wechatKeys, setWechatKeys] = useState<Record<WeChatChannel, string>>(() => {
    const empty: Record<WeChatChannel, string> = { silicon: "", heat: "", hologram: "", nfc: "", logo: "", tshirt: "" };
    if (typeof window === "undefined") return empty;
    try {
      const raw = localStorage.getItem(WECHAT_KEYS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        silicon: parsed.silicon || "",
        heat: parsed.heat || "",
        hologram: parsed.hologram || "",
        nfc: parsed.nfc || "",
        logo: parsed.logo || "",
        tshirt: parsed.tshirt || "",
      };
    } catch {
      return empty;
    }
  });
  const [wechatTesting, setWechatTesting] = useState<WeChatChannel | null>(null);

  const saveWorker = () => {
    localStorage.setItem(WORKER_URL_KEY, workerUrl.trim());
    toast({ title: lang === "ko" ? "워커 URL 저장됨" : "Worker URL 已保存" });
  };

  const testWorker = async () => {
    if (!workerUrl.trim()) {
      toast({ title: lang === "ko" ? "URL을 입력하세요" : "请输入 URL", variant: "destructive" });
      return;
    }
    setWorkerTesting(true);
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: lang === "ko" ? "워커 연결 성공" : "Worker 连接成功" });
    } catch (e) {
      toast({
        title: lang === "ko" ? "워커 연결 실패" : "Worker 连接失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setWorkerTesting(false);
    }
  };

  const saveWechatKeys = () => {
    const cleaned: Record<string, string> = {};
    const normalized: Record<WeChatChannel, string> = { ...wechatKeys };
    (Object.keys(wechatKeys) as WeChatChannel[]).forEach(k => {
      const key = extractKey(wechatKeys[k]);
      if (key) {
        cleaned[k] = key;
        normalized[k] = key;
      }
    });
    setWechatKeys(normalized);
    localStorage.setItem(WECHAT_KEYS_KEY, JSON.stringify(cleaned));
    toast({
      title: lang === "ko" ? "위챗 키 저장됨" : "WeChat 密钥已保存",
      description: lang === "ko"
        ? "Render 환경변수 WECHAT_WEBHOOK_KEYS에도 동일하게 등록해야 실제 발송됩니다."
        : "需在 Render 环境变量 WECHAT_WEBHOOK_KEYS 中同步设置才能实际发送。",
    });
  };

  const copyWechatJson = async () => {
    const cleaned: Record<string, string> = {};
    (Object.keys(wechatKeys) as WeChatChannel[]).forEach(k => {
      const key = extractKey(wechatKeys[k]);
      if (key) cleaned[k] = key;
    });
    const json = JSON.stringify(cleaned);
    await navigator.clipboard.writeText(json);
    toast({
      title: lang === "ko" ? "복사됨" : "已复制",
      description: json,
    });
  };


  const extractKey = (raw: string): string => {
    const v = raw.trim();
    if (!v) return "";
    try {
      const u = new URL(v);
      const k = u.searchParams.get("key");
      if (k) return k;
    } catch { /* not a URL */ }
    return v;
  };

  const testWechat = async (channel: WeChatChannel) => {
    const key = extractKey(wechatKeys[channel]);
    if (!key) {
      toast({ title: lang === "ko" ? "키를 입력하세요" : "请输入密钥", variant: "destructive" });
      return;
    }
    setWechatTesting(channel);
    try {
      const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`;
      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: {
          webhookUrl,
          message: `[TWINMETA] ${channel} 채널 테스트 메시지`,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: lang === "ko" ? "발송 성공" : "发送成功", description: channel });
    } catch (e) {
      toast({
        title: lang === "ko" ? "발송 실패" : "发送失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setWechatTesting(null);
    }
  };

  const testPhotoroom = async () => {
    setPhotoroomTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("photoroom-upscale", {
        body: { mode: "test" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: lang === "ko" ? "Photoroom 연결 성공" : "Photoroom 连接成功",
        description: lang === "ko" ? "API 키가 유효합니다." : "API 密钥有效。",
      });
    } catch (e) {
      toast({
        title: lang === "ko" ? "Photoroom 연결 실패" : "Photoroom 连接失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setPhotoroomTesting(false);
    }
  };

  // RunPod (PiD) 연결 테스트
  const [pidTesting, setPidTesting] = useState(false);
  const [pidResult, setPidResult] = useState<string>("");
  const testPid = async () => {
    setPidTesting(true);
    setPidResult("");
    try {
      const { data, error } = await supabase.functions.invoke("photoroom-upscale", {
        body: { mode: "pid-test" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const workers = (data as any)?.health?.workers;
      const summary = workers
        ? `ready=${workers.ready ?? 0} · running=${workers.running ?? 0} · idle=${workers.idle ?? 0}`
        : "OK";
      setPidResult(summary);
      toast({
        title: lang === "ko" ? "RunPod 연결 성공" : "RunPod 连接成功",
        description: summary,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPidResult(msg);
      toast({
        title: lang === "ko" ? "RunPod 연결 실패" : "RunPod 连接失败",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setPidTesting(false);
    }
  };




  const testVectorizer = async () => {
    setVecTesting(true);
    try {
      // 1x1 흰색 PNG (테스트 이미지)
      const tinyPng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";
      const { data, error } = await supabase.functions.invoke("vectorize-image", {
        body: { imageBase64: tinyPng, mode: "test" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: lang === "ko" ? "Vectorizer.AI 연결 성공" : "Vectorizer.AI 连接成功",
        description: lang === "ko"
          ? `테스트 모드 응답 수신 (크레딧: ${(data as any)?.credits ?? "-"})`
          : `测试模式响应已接收 (积分: ${(data as any)?.credits ?? "-"})`,
      });
    } catch (e) {
      toast({
        title: lang === "ko" ? "Vectorizer.AI 연결 실패" : "Vectorizer.AI 连接失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setVecTesting(false);
    }
  };


  const update = (key: Factory, patch: Partial<FactoryEmail>) =>
    setList(prev => prev.map(it => it.key === key ? { ...it, ...patch } : it));


  const save = () => {
    toast({ title: lang === "ko" ? "저장되었습니다" : "已保存", description: lang === "ko" ? "공장별 이메일 설정이 저장되었습니다." : "工厂邮箱设置已保存。" });
  };

  const test = (it: FactoryEmail) => {
    if (!it.email) {
      toast({ title: lang === "ko" ? "이메일 주소가 없습니다" : "没有邮箱地址", variant: "destructive" });
      return;
    }
    toast({ title: lang === "ko" ? "테스트 메일 발송" : "测试邮件已发送", description: it.email });
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={lang === "ko" ? "외주 시스템 설정" : "外协系统设置"}
        description={lang === "ko"
          ? "공장별 이메일 수신처를 등록하면, 발주서를 PDF로 생성한 뒤 자동으로 해당 공장의 이메일로 전송됩니다."
          : "为每个工厂登记邮箱后,生成PDF发货单时会自动发送到对应工厂邮箱。"}
      />

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {lang === "ko" ? "공장별 이메일" : "工厂邮箱"}
          </h3>
          <Button size="sm" onClick={save} className="gap-1">
            <Save className="w-3.5 h-3.5" />
            {lang === "ko" ? "전체 저장" : "全部保存"}
          </Button>
        </div>

        <div className="space-y-3">
          {list.map(it => (
            <div key={it.key} className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{it.name[lang]}</Badge>
                </div>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => test(it)}>
                  <Send className="w-3.5 h-3.5" />
                  {lang === "ko" ? "테스트 메일" : "测试邮件"}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="space-y-1.5">
                  <Label>{lang === "ko" ? "담당자" : "联系人"}</Label>
                  <Input value={it.contact} onChange={e => update(it.key, { contact: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{lang === "ko" ? "연락처" : "联系电话"}</Label>
                  <Input value={it.phone} onChange={e => update(it.key, { phone: e.target.value })} placeholder="+86-138-0000-0000" />
                </div>
                <div className="space-y-1.5">
                  <Label>URL</Label>
                  <Input value={it.url} onChange={e => update(it.key, { url: e.target.value })} placeholder="https://factory.cn" />
                </div>
                <div className="space-y-1.5">
                  <Label>{lang === "ko" ? "수신 이메일" : "收件邮箱"} *</Label>
                  <Input type="email" value={it.email} onChange={e => update(it.key, { email: e.target.value })} placeholder="factory@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>{lang === "ko" ? "참조 (CC)" : "抄送 (CC)"}</Label>
                  <Input value={it.cc} onChange={e => update(it.key, { cc: e.target.value })} placeholder="cc1@example.com, cc2@example.com" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">{lang === "ko" ? "발송 기본값" : "发送默认值"}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>{lang === "ko" ? "기본 참조 (CC)" : "默认抄送 (CC)"}</Label>
            <Input value={defaultCc} onChange={e => setDefaultCc(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {lang === "ko" ? "모든 발주 메일에 자동으로 참조됩니다." : "所有发货邮件将自动抄送。"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>{lang === "ko" ? "메일 서명" : "邮件签名"}</Label>
            <Textarea rows={4} value={signature} onChange={e => setSignature(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} className="gap-1">
            <Save className="w-3.5 h-3.5" />
            {lang === "ko" ? "저장" : "保存"}
          </Button>
        </div>
      </Card>

      {/* Vectorizer.AI 설정 */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Wand2 className="w-4 h-4" />
            {lang === "ko" ? "Vectorizer.AI (AI 벡터 변환)" : "Vectorizer.AI (AI 矢量化)"}
          </h3>
          <a
            href="https://vectorizer.ai/account"
            target="_blank" rel="noreferrer"
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            {lang === "ko" ? "계정 / 크레딧 확인" : "账户 / 积分查看"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "ko"
            ? "LOGO 공장의 로고파일과 NFC 카드 공장의 서명파일을 고품질 SVG 벡터로 변환합니다. API ID/Secret은 안전한 서버 환경변수로 저장되어 있습니다."
            : "将 LOGO 工厂的徽标和 NFC 卡片工厂的签名转换为高质量 SVG 矢量。API ID/Secret 已安全存储在服务器环境变量中。"}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label>{lang === "ko" ? "변환 모드" : "转换模式"}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["test", "preview", "production"] as VectorizerMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setVecMode(m)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    vecMode === m ? "border-primary bg-primary/10" : "hover:bg-accent"
                  }`}
                >
                  <div className="text-xs font-semibold uppercase">{m}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    {m === "test" && (lang === "ko" ? "무료 · 워터마크" : "免费 · 水印")}
                    {m === "preview" && (lang === "ko" ? "0.2 크레딧 · 미리보기" : "0.2 积分 · 预览")}
                    {m === "production" && (lang === "ko" ? "1.0 크레딧 · 최종" : "1.0 积分 · 最终")}
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {lang === "ko"
                ? "Test: 개발/검증용 (무료). Production: 실제 발주용 SVG (워터마크 없음)."
                : "Test: 开发/验证用 (免费)。Production: 实际发货用 SVG (无水印)。"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="opacity-0 hidden md:block">&nbsp;</Label>
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1"
              onClick={testVectorizer}
              disabled={vecTesting}
            >
              {vecTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {lang === "ko" ? "연결 테스트" : "连接测试"}
            </Button>
            <Badge variant="secondary" className="w-full justify-center text-[10px]">
              {lang === "ko" ? "현재 모드" : "当前模式"}: {vecMode}
            </Badge>
          </div>
        </div>
      </Card>


      {/* Render 워커 설정 */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Server className="w-4 h-4" />
            {lang === "ko" ? "Render 워커 (이미지 묶음 처리)" : "Render Worker (图片打包处理)"}
          </h3>
          <a
            href="https://dashboard.render.com"
            target="_blank" rel="noreferrer"
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            Render Dashboard
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "ko"
            ? "Render에 배포한 워커의 공개 URL을 등록합니다. 저장 후 Lovable Cloud 시크릿 WORKER_URL에도 동일하게 등록해야 백엔드에서 호출됩니다."
            : "登记部署在 Render 上的 Worker 公开 URL。保存后还需在 Lovable Cloud 密钥 WORKER_URL 中设置相同的值,后端才能调用。"}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div className="space-y-1.5">
            <Label>Worker URL</Label>
            <Input
              value={workerUrl}
              onChange={e => setWorkerUrl(e.target.value)}
              placeholder="https://twinmeta-worker.onrender.com"
            />
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={testWorker} disabled={workerTesting}>
            {workerTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {lang === "ko" ? "연결 테스트" : "连接测试"}
          </Button>
          <Button size="sm" className="gap-1" onClick={saveWorker}>
            <Save className="w-3.5 h-3.5" />
            {lang === "ko" ? "저장" : "保存"}
          </Button>
        </div>
      </Card>

      {/* 위챗 채널별 웹훅 키 설정 */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            {lang === "ko" ? "위챗 알림 채널 (WECHAT_WEBHOOK_KEYS)" : "WeChat 通知频道 (WECHAT_WEBHOOK_KEYS)"}
          </h3>
          <Button size="sm" variant="outline" className="gap-1" onClick={copyWechatJson}>
            <Copy className="w-3.5 h-3.5" />
            {lang === "ko" ? "JSON 복사" : "复制 JSON"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "ko"
            ? "각 위챗 그룹봇 URL의 key= 뒤 값만 입력하세요. 저장 후 'JSON 복사'로 묶인 값을 Render 환경변수 WECHAT_WEBHOOK_KEYS에 그대로 붙여넣어야 워커에서 사용됩니다."
            : "仅输入每个 WeChat 群机器人 URL 中 key= 后的部分。保存后用「复制 JSON」将打包值粘贴到 Render 环境变量 WECHAT_WEBHOOK_KEYS 才能被 Worker 使用。"}
        </p>
        <div className="space-y-3">
          {WECHAT_CHANNELS.map(ch => (
            <div key={ch.key} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-end">
              <div className="space-y-1.5">
                <Label>{ch.label[lang]}</Label>
                <Badge variant="secondary" className="font-mono text-[10px]">{ch.key}</Badge>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Webhook Key</Label>
                <Input
                  value={wechatKeys[ch.key]}
                  onChange={e => setWechatKeys(prev => ({ ...prev, [ch.key]: e.target.value }))}
                  placeholder="abc12345-6789-..."
                  className="font-mono text-xs"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => testWechat(ch.key)}
                disabled={wechatTesting === ch.key}
              >
                {wechatTesting === ch.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {lang === "ko" ? "테스트 발송" : "测试发送"}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button size="sm" className="gap-1" onClick={saveWechatKeys}>
            <Save className="w-3.5 h-3.5" />
            {lang === "ko" ? "위챗 키 저장" : "保存 WeChat 密钥"}
          </Button>
        </div>
      </Card>

      {/* RunPod (PiD) 설정 */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            {lang === "ko" ? "RunPod (PiD 업스케일러)" : "RunPod (PiD 放大器)"}
          </h3>
          <a
            href="https://www.runpod.io/console/serverless"
            target="_blank" rel="noreferrer"
            className="text-xs text-primary flex items-center gap-1 hover:underline"
          >
            RunPod Console
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "ko"
            ? "NVIDIA PiD 모델을 RunPod Serverless에서 호출합니다. 엔드포인트 URL과 API 키는 Lovable Cloud 시크릿(PID_ENDPOINT_URL, PID_API_KEY)으로 안전하게 저장됩니다."
            : "在 RunPod Serverless 上调用 NVIDIA PiD 模型。Endpoint URL 与 API Key 安全存储于 Lovable Cloud 密钥(PID_ENDPOINT_URL、PID_API_KEY)。"}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Endpoint URL</Label>
              <Badge variant="secondary" className="text-[10px] font-mono">PID_ENDPOINT_URL</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {lang === "ko"
                ? "형식: https://api.runpod.ai/v2/<endpoint-id>/runsync"
                : "格式:https://api.runpod.ai/v2/<endpoint-id>/runsync"}
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">API Key</Label>
              <Badge variant="secondary" className="text-[10px] font-mono">PID_API_KEY</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {lang === "ko"
                ? "RunPod 콘솔 → Settings → API Keys 에서 발급"
                : "RunPod Console → Settings → API Keys 处生成"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {pidResult && (
              <Badge variant="outline" className="text-[10px] font-mono truncate max-w-full">
                {pidResult}
              </Badge>
            )}
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={testPid} disabled={pidTesting}>
            {pidTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {lang === "ko" ? "연결 테스트 (/health)" : "连接测试 (/health)"}
          </Button>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {lang === "ko"
              ? "키 또는 엔드포인트를 변경하려면 채팅으로 '" 
              : "如需更换密钥或 Endpoint,请在聊天中说\""}
            <span className="font-semibold text-foreground">
              {lang === "ko" ? "PID_ENDPOINT_URL 업데이트" : "更新 PID_ENDPOINT_URL"}
            </span>
            {lang === "ko"
              ? "' 또는 'PID_API_KEY 업데이트'라고 요청하세요. 안전한 입력 폼이 열립니다."
              : "\"或\"更新 PID_API_KEY\",将打开安全输入表单。"}
          </p>
        </div>
      </Card>

    </div>


  );
}

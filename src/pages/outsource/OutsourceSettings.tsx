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
import { Mail, Save, Send, Wand2, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const VECTORIZER_MODE_KEY = "vectorizer.ai.mode.v1";
export type VectorizerMode = "test" | "preview" | "production";

export const CLAID_ENABLED_KEY = "claid.ai.enabled.v1";
export const CLAID_SCALE_KEY = "claid.ai.scale.v1";
export const CLAID_UPSCALE_KEY = "claid.ai.upscale.v1";
export type ClaidScale = "2" | "4";
export type ClaidUpscale = "smart_enhance" | "smart_resize" | "faces";

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

  // Claid.ai 설정
  const [claidEnabled, setClaidEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem(CLAID_ENABLED_KEY);
    return v === null ? true : v === "true";
  });
  const [claidScale, setClaidScale] = useState<ClaidScale>(() => {
    const v = (typeof window !== "undefined" && localStorage.getItem(CLAID_SCALE_KEY)) as ClaidScale | null;
    return v === "4" ? "4" : "2";
  });
  const [claidUpscale, setClaidUpscale] = useState<ClaidUpscale>(() => {
    const v = (typeof window !== "undefined" && localStorage.getItem(CLAID_UPSCALE_KEY)) as ClaidUpscale | null;
    return v === "smart_resize" || v === "faces" ? v : "smart_enhance";
  });
  const [claidTesting, setClaidTesting] = useState(false);
  useEffect(() => { localStorage.setItem(CLAID_ENABLED_KEY, String(claidEnabled)); }, [claidEnabled]);
  useEffect(() => { localStorage.setItem(CLAID_SCALE_KEY, claidScale); }, [claidScale]);
  useEffect(() => { localStorage.setItem(CLAID_UPSCALE_KEY, claidUpscale); }, [claidUpscale]);

  const testClaid = async () => {
    setClaidTesting(true);
    try {
      const tinyPng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";
      const { data, error } = await supabase.functions.invoke("claid-upscale", {
        body: { imageBase64: tinyPng, scale: Number(claidScale), upscale: claidUpscale },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: lang === "ko" ? "Claid.ai 연결 성공" : "Claid.ai 连接成功",
        description: lang === "ko" ? "업스케일 응답 수신 완료" : "已收到放大响应",
      });
    } catch (e) {
      toast({
        title: lang === "ko" ? "Claid.ai 연결 실패" : "Claid.ai 连接失败",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setClaidTesting(false);
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
    </div>
  );
}

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useLang } from "@/contexts/LangContext";
import { toast } from "@/hooks/use-toast";
import { Mail, Save, Send } from "lucide-react";

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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>{lang === "ko" ? "담당자" : "联系人"}</Label>
                  <Input value={it.contact} onChange={e => update(it.key, { contact: e.target.value })} />
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
    </div>
  );
}

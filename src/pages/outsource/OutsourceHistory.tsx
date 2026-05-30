import { useMemo, useState, useEffect } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { CheckCircle2, Search, ExternalLink, Send, Settings2, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Factory = "silicon" | "heat" | "hologram" | "nfc" | "logo";
type Status = "ordered" | "shipped" | "received";

interface HistoryRow {
  id: string;
  factory: Factory;
  orderNo: string;
  orderedAt: string;
  qty: number;
  productCode: string;
  startedAt?: string;
  expectedAt?: string;
  producedAt?: string;
  shippedAt?: string;
  trackingNo?: string;
  carrier?: string;
  receivedAt?: string;
  status: Status;
}

const FACTORY_LABEL_KO: Record<Factory, string> = {
  silicon: "실리콘 마크 공장",
  heat: "열전사 디자인 공장",
  hologram: "홀로그램 스티커 공장",
  nfc: "NFC 카드 공장",
  logo: "LOGO 공장",
};
const FACTORY_LABEL_ZH: Record<Factory, string> = {
  silicon: "硅胶标识工厂",
  heat: "热转印设计工厂",
  hologram: "全息贴纸工厂",
  nfc: "NFC卡片工厂",
  logo: "LOGO工厂",
};

// 중국 주요 택배사
const CARRIERS: { value: string; labelKo: string; labelZh: string; trackUrl: (no: string) => string }[] = [
  { value: "SF",   labelKo: "순펑(SF Express)", labelZh: "顺丰速运", trackUrl: (n) => `https://www.sf-express.com/chn/sc/dynamic_function/waybill/#search/bill-number/${n}` },
  { value: "YTO",  labelKo: "위엔통(YTO)",      labelZh: "圆通速递", trackUrl: (n) => `https://www.yto.net.cn/Track/?wb=${n}` },
  { value: "ZTO",  labelKo: "쫑통(ZTO)",        labelZh: "中通快递", trackUrl: (n) => `https://www.zto.com/express/expressCheck.html?txtbill=${n}` },
  { value: "STO",  labelKo: "션통(STO)",        labelZh: "申通快递", trackUrl: (n) => `https://www.sto.cn/chaxun/index.html?bills=${n}` },
  { value: "YUNDA",labelKo: "윈다(YUNDA)",      labelZh: "韵达快递", trackUrl: (n) => `https://www.yundaex.com/cn/index.php?moduleName=Track&number=${n}` },
  { value: "JD",   labelKo: "징동(JD)",         labelZh: "京东物流", trackUrl: (n) => `https://www.jdl.com/orderSearch/?waybillCodes=${n}` },
  { value: "EMS",  labelKo: "EMS",              labelZh: "中国邮政EMS", trackUrl: (n) => `https://www.ems.com.cn/queryList?mailNum=${n}` },
];

const SAMPLE: HistoryRow[] = [
  { id: "H001", factory: "silicon", orderNo: "TM-2026-0001", orderedAt: "2026-05-12", qty: 220, productCode: "TS-RED-100", startedAt: "2026-05-12", expectedAt: "2026-05-14", producedAt: "2026-05-14", shippedAt: "2026-05-14", trackingNo: "SF1234567890", carrier: "SF", receivedAt: "2026-05-17", status: "received" },
  { id: "H002", factory: "heat", orderNo: "TM-2026-0001", orderedAt: "2026-05-12", qty: 220, productCode: "TS-RED-100", startedAt: "2026-05-12", expectedAt: "2026-05-15", producedAt: "2026-05-15", shippedAt: "2026-05-15", trackingNo: "YT9988776655", carrier: "YTO", status: "shipped" },
  { id: "H003", factory: "hologram", orderNo: "TM-2026-0002", orderedAt: "2026-05-13", qty: 330, productCode: "TS-BLU-200", startedAt: "2026-05-13", expectedAt: "2026-05-16", status: "ordered" },
  { id: "H004", factory: "nfc", orderNo: "TM-2026-0002", orderedAt: "2026-05-13", qty: 330, productCode: "TS-BLU-200", startedAt: "2026-05-13", expectedAt: "2026-05-16", producedAt: "2026-05-16", shippedAt: "2026-05-16", trackingNo: "ZTO11223344", carrier: "ZTO", status: "shipped" },
  { id: "H005", factory: "logo", orderNo: "TM-2026-0003", orderedAt: "2026-05-14", qty: 165, productCode: "LOGO-A", startedAt: "2026-05-14", expectedAt: "2026-05-15", producedAt: "2026-05-15", shippedAt: "2026-05-15", trackingNo: "JD556677889", carrier: "JD", receivedAt: "2026-05-18", status: "received" },
  { id: "H006", factory: "silicon", orderNo: "TM-2026-0004", orderedAt: "2026-05-15", qty: 110, productCode: "TS-BLK-300", startedAt: "2026-05-15", expectedAt: "2026-05-18", status: "ordered" },
  { id: "H007", factory: "logo", orderNo: "TM-2026-0004", orderedAt: "2026-05-15", qty: 110, productCode: "LOGO-B", startedAt: "2026-05-15", expectedAt: "2026-05-16", producedAt: "2026-05-16", shippedAt: "2026-05-16", trackingNo: "EMS998877665", carrier: "EMS", status: "shipped" },
];

const WECHAT_HOOKS_STORAGE_KEY = "outsource.wechatWebhooks.v1";

export default function OutsourceHistory() {
  const { lang } = useLang();
  const [rows, setRows] = useState<HistoryRow[]>(SAMPLE);
  const [factoryFilter, setFactoryFilter] = useState<Factory | "all">("all");
  const [q, setQ] = useState("");
  const [hooks, setHooks] = useState<Record<Factory, string>>({
    silicon: "", heat: "", hologram: "", nfc: "", logo: "",
  });
  const [hooksOpen, setHooksOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WECHAT_HOOKS_STORAGE_KEY);
      if (raw) setHooks({ silicon: "", heat: "", hologram: "", nfc: "", logo: "", ...JSON.parse(raw) });
    } catch { /* ignore */ }
  }, []);

  const saveHooks = (next: Record<Factory, string>) => {
    setHooks(next);
    try { localStorage.setItem(WECHAT_HOOKS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    toast({ title: lang === "ko" ? "위챗 Webhook 저장 완료" : "已保存企业微信 Webhook" });
  };

  const factoryLabel = lang === "ko" ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH;

  const filtered = useMemo(() => rows.filter(r =>
    (factoryFilter === "all" || r.factory === factoryFilter) &&
    (!q || r.orderNo.toLowerCase().includes(q.toLowerCase()) || (r.trackingNo ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, factoryFilter, q]);

  const stats = useMemo(() => ({
    total: rows.length,
    ordered: rows.filter(r => r.status === "ordered").length,
    shipped: rows.filter(r => r.status === "shipped").length,
    received: rows.filter(r => r.status === "received").length,
  }), [rows]);

  const updateRow = (id: string, patch: Partial<HistoryRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const confirmReceived = (id: string) => {
    updateRow(id, { status: "received", receivedAt: new Date().toISOString().slice(0, 10) });
    toast({ title: lang === "ko" ? "수령 확인 완료" : "已确认收货" });
  };

  const openTracking = (carrier?: string, no?: string) => {
    if (!carrier || !no) return;
    const c = CARRIERS.find(x => x.value === carrier);
    if (!c) {
      window.open(`https://t.17track.net/zh-cn#nums=${no}`, "_blank");
      return;
    }
    window.open(c.trackUrl(no), "_blank");
  };

  const buildOrderMessage = (r: HistoryRow) => {
    const factoryZh = FACTORY_LABEL_ZH[r.factory];
    const lines = [
      `【TWINMETA 发货通知 / 발주】`,
      `工厂 / 공장: ${factoryZh}`,
      `订单号 / 작업번호: ${r.orderNo}`,
      `产品编号 / 제품코드: ${r.productCode}`,
      `数量 / 수량: ${r.qty.toLocaleString()}`,
      `发单日期 / 발주일: ${r.orderedAt}`,
      r.startedAt && `开始制作 / 제작착수: ${r.startedAt}`,
      r.expectedAt && `预计制作完成日 / 예상 제작 완료일: ${r.expectedAt}`,
      `——`,
      `请确认并按时交付。감사합니다.`,
    ].filter(Boolean);
    return lines.join("\n");
  };

  const sendToWeChat = async (r: HistoryRow) => {
    const url = hooks[r.factory]?.trim();
    if (!url) {
      toast({
        title: lang === "ko" ? "Webhook 미설정" : "未设置 Webhook",
        description: lang === "ko"
          ? `${FACTORY_LABEL_KO[r.factory]}의 위챗 Webhook을 먼저 등록하세요.`
          : `请先为 ${FACTORY_LABEL_ZH[r.factory]} 配置企业微信 Webhook。`,
        variant: "destructive",
      });
      setHooksOpen(true);
      return;
    }
    setSendingId(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("wechat-send", {
        body: { webhookUrl: url, message: buildOrderMessage(r) },
      });
      if (error || (data as any)?.error) {
        throw new Error(error?.message ?? (data as any)?.error ?? "Unknown error");
      }
      toast({ title: lang === "ko" ? "위챗 발송 완료" : "已发送到企业微信" });
    } catch (e: any) {
      toast({
        title: lang === "ko" ? "위챗 발송 실패" : "发送失败",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={lang === "ko" ? "발주 이력 관리" : "发货历史管理"}
        description={lang === "ko"
          ? "5개 외주 공장(실리콘 / 열전사 / 홀로그램 / NFC / LOGO)으로 발주된 모든 이력을 한 곳에서 추적합니다."
          : "在一处追踪所有发往5个外协工厂的订单历史。"}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: lang === "ko" ? "전체" : "全部", value: stats.total },
          { label: lang === "ko" ? "발주" : "已发单", value: stats.ordered },
          { label: lang === "ko" ? "발송" : "已发货", value: stats.shipped },
          { label: lang === "ko" ? "수령 완료" : "已收货", value: stats.received },
        ].map(s => (
          <Card key={s.label} className="p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-2xl font-semibold mt-1">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={lang === "ko" ? "작업번호 / 송장번호 검색" : "搜索订单号 / 运单号"}
              className="pl-8"
            />
          </div>
          <Select value={factoryFilter} onValueChange={v => setFactoryFilter(v as Factory | "all")}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === "ko" ? "전체 공장" : "全部工厂"}</SelectItem>
              {(Object.keys(factoryLabel) as Factory[]).map(f => (
                <SelectItem key={f} value={f}>{factoryLabel[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{lang === "ko" ? "공장" : "工厂"}</TableHead>
                <TableHead>{lang === "ko" ? "작업번호" : "作业号"}</TableHead>
                <TableHead className="text-right">{lang === "ko" ? "수량" : "数量"}</TableHead>
                <TableHead>{lang === "ko" ? "발주일" : "发单日期"}</TableHead>
                <TableHead className="min-w-[140px]">{lang === "ko" ? "제작 착수" : "开始制作"}</TableHead>
                <TableHead className="min-w-[140px]">{lang === "ko" ? "예상 제작 완료일" : "预计制作完成日"}</TableHead>
                <TableHead className="min-w-[140px]">{lang === "ko" ? "제작완료" : "制作完成"}</TableHead>
                <TableHead className="min-w-[140px]">{lang === "ko" ? "발송일" : "发货日期"}</TableHead>
                <TableHead className="min-w-[260px]">{lang === "ko" ? "송장번호" : "运单号"}</TableHead>
                <TableHead className="text-right min-w-[140px]">{lang === "ko" ? "수령확인" : "确认收货"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary">{factoryLabel[r.factory]}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{r.orderNo}</TableCell>
                  <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                  <TableCell>{r.orderedAt}</TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={r.startedAt ?? ""}
                      onChange={e => updateRow(r.id, { startedAt: e.target.value })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={r.expectedAt ?? ""}
                      onChange={e => updateRow(r.id, { expectedAt: e.target.value })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={r.producedAt ?? ""}
                      onChange={e => updateRow(r.id, { producedAt: e.target.value })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={r.shippedAt ?? ""}
                      onChange={e => {
                        const v = e.target.value;
                        updateRow(r.id, {
                          shippedAt: v,
                          status: v && r.status === "ordered" ? "shipped" : r.status,
                        });
                      }}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      <Select
                        value={r.carrier ?? ""}
                        onValueChange={v => updateRow(r.id, { carrier: v })}
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue placeholder={lang === "ko" ? "택배사" : "快递"} />
                        </SelectTrigger>
                        <SelectContent>
                          {CARRIERS.map(c => (
                            <SelectItem key={c.value} value={c.value}>
                              {lang === "ko" ? c.labelKo : c.labelZh}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={r.trackingNo ?? ""}
                        onChange={e => updateRow(r.id, { trackingNo: e.target.value })}
                        placeholder={lang === "ko" ? "송장번호" : "运单号"}
                        className="h-8 flex-1 min-w-[110px]"
                      />
                      {r.trackingNo && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          title={lang === "ko" ? "운송상태 조회" : "查询物流"}
                          onClick={() => openTracking(r.carrier, r.trackingNo)}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "received" ? (
                      <Badge variant="outline" className="gap-1 bg-success/15 text-success">
                        <CheckCircle2 className="w-3 h-3" />
                        {lang === "ko" ? "수령 완료" : "已收货"}
                        {r.receivedAt && <span className="ml-1 text-[10px] opacity-70">{r.receivedAt}</span>}
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => confirmReceived(r.id)}>
                        {lang === "ko" ? "수령확인" : "确认收货"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    {lang === "ko" ? "조회된 발주 이력이 없습니다." : "暂无发货历史。"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

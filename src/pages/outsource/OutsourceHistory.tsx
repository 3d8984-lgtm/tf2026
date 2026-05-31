import { useMemo, useState, useEffect, useCallback } from "react";
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
import { CheckCircle2, Search, ExternalLink, Send, Settings2, Loader2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Factory = "silicon" | "heat" | "hologram" | "nfc" | "logo";
type Status = "ordered" | "shipped" | "received";

interface HistoryRow {
  id: string;
  factory: Factory;
  order_no: string;
  ordered_at: string;
  quantity: number;
  product_code: string;
  started_at: string | null;
  expected_at: string | null;
  produced_at: string | null;
  shipped_at: string | null;
  tracking_no: string | null;
  carrier: string | null;
  received_at: string | null;
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

const CARRIERS: { value: string; labelKo: string; labelZh: string; trackUrl: (no: string) => string }[] = [
  { value: "SF",   labelKo: "순펑(SF Express)", labelZh: "顺丰速运", trackUrl: (n) => `https://www.sf-express.com/chn/sc/dynamic_function/waybill/#search/bill-number/${n}` },
  { value: "YTO",  labelKo: "위엔통(YTO)",      labelZh: "圆通速递", trackUrl: (n) => `https://www.yto.net.cn/Track/?wb=${n}` },
  { value: "ZTO",  labelKo: "쫑통(ZTO)",        labelZh: "中通快递", trackUrl: (n) => `https://www.zto.com/express/expressCheck.html?txtbill=${n}` },
  { value: "STO",  labelKo: "션통(STO)",        labelZh: "申通快递", trackUrl: (n) => `https://www.sto.cn/chaxun/index.html?bills=${n}` },
  { value: "YUNDA",labelKo: "윈다(YUNDA)",      labelZh: "韵达快递", trackUrl: (n) => `https://www.yundaex.com/cn/index.php?moduleName=Track&number=${n}` },
  { value: "JD",   labelKo: "징동(JD)",         labelZh: "京东物流", trackUrl: (n) => `https://www.jdl.com/orderSearch/?waybillCodes=${n}` },
  { value: "EMS",  labelKo: "EMS",              labelZh: "中国邮政EMS", trackUrl: (n) => `https://www.ems.com.cn/queryList?mailNum=${n}` },
];

const WECHAT_HOOKS_STORAGE_KEY = "outsource.wechatWebhooks.v1";

const EDITABLE_DATE_FIELDS = ["started_at", "expected_at", "produced_at", "shipped_at"] as const;

export default function OutsourceHistory() {
  const { lang } = useLang();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [factoryFilter, setFactoryFilter] = useState<Factory | "all">("all");
  const [q, setQ] = useState("");
  const [hooks, setHooks] = useState<Record<Factory, string>>({
    silicon: "", heat: "", hologram: "", nfc: "", logo: "",
  });
  const [hooksOpen, setHooksOpen] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ factory: Factory; order_no: string; product_code: string; quantity: number; ordered_at: string }>({
    factory: "silicon", order_no: "", product_code: "", quantity: 0, ordered_at: new Date().toISOString().slice(0, 10),
  });

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("outsource_orders")
      .select("*")
      .order("ordered_at", { ascending: false });
    if (error) {
      toast({ title: lang === "ko" ? "조회 실패" : "查询失败", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as HistoryRow[]);
    }
    setLoading(false);
  }, [lang]);

  useEffect(() => { loadRows(); }, [loadRows]);

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
    (!q || r.order_no.toLowerCase().includes(q.toLowerCase()) || (r.tracking_no ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, factoryFilter, q]);

  const stats = useMemo(() => ({
    total: rows.length,
    ordered: rows.filter(r => r.status === "ordered").length,
    shipped: rows.filter(r => r.status === "shipped").length,
    received: rows.filter(r => r.status === "received").length,
  }), [rows]);

  const persist = async (id: string, patch: Partial<HistoryRow>) => {
    const prev = rows;
    setRows(p => p.map(r => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("outsource_orders").update(patch).eq("id", id);
    if (error) {
      setRows(prev);
      toast({ title: lang === "ko" ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" });
    }
  };

  const handleDateChange = (id: string, field: typeof EDITABLE_DATE_FIELDS[number], value: string, currentStatus: Status) => {
    const patch: Partial<HistoryRow> = { [field]: value || null } as any;
    if (field === "shipped_at" && value && currentStatus === "ordered") patch.status = "shipped";
    persist(id, patch);
  };

  const confirmReceived = (id: string) => {
    persist(id, { status: "received", received_at: new Date().toISOString().slice(0, 10) });
    toast({ title: lang === "ko" ? "수령 확인 완료" : "已确认收货" });
  };

  const openTracking = (carrier?: string | null, no?: string | null) => {
    if (!no) return;
    const c = CARRIERS.find(x => x.value === carrier);
    if (!c) { window.open(`https://t.17track.net/zh-cn#nums=${no}`, "_blank"); return; }
    window.open(c.trackUrl(no), "_blank");
  };

  const buildOrderMessage = (r: HistoryRow) => {
    const factoryZh = FACTORY_LABEL_ZH[r.factory];
    const lines = [
      `【TWINMETA 发货通知 / 발주】`,
      `工厂 / 공장: ${factoryZh}`,
      `订单号 / 작업번호: ${r.order_no}`,
      `产品编号 / 제품코드: ${r.product_code}`,
      `数量 / 수량: ${r.quantity.toLocaleString()}`,
      `发单日期 / 발주일: ${r.ordered_at}`,
      r.started_at && `开始制作 / 제작착수: ${r.started_at}`,
      r.expected_at && `预计制作完成日 / 예상 제작 완료일: ${r.expected_at}`,
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
        description: lang === "ko" ? `${FACTORY_LABEL_KO[r.factory]}의 위챗 Webhook을 먼저 등록하세요.` : `请先为 ${FACTORY_LABEL_ZH[r.factory]} 配置企业微信 Webhook。`,
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
      if (error || (data as any)?.error) throw new Error(error?.message ?? (data as any)?.error ?? "Unknown error");
      toast({ title: lang === "ko" ? "위챗 발송 완료" : "已发送到企业微信" });
    } catch (e: any) {
      toast({ title: lang === "ko" ? "위챗 발송 실패" : "发送失败", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const createOrder = async () => {
    if (!draft.order_no || !draft.product_code) {
      toast({ title: lang === "ko" ? "작업번호/제품코드를 입력하세요" : "请输入订单号/产品编号", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("outsource_orders").insert({
      factory: draft.factory, order_no: draft.order_no, product_code: draft.product_code,
      quantity: draft.quantity, ordered_at: draft.ordered_at, status: "ordered",
    });
    setCreating(false);
    if (error) {
      toast({ title: lang === "ko" ? "등록 실패" : "登记失败", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: lang === "ko" ? "발주 등록 완료" : "已登记发货" });
    setCreateOpen(false);
    setDraft({ factory: "silicon", order_no: "", product_code: "", quantity: 0, ordered_at: new Date().toISOString().slice(0, 10) });
    loadRows();
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
            <Input value={q} onChange={e => setQ(e.target.value)}
              placeholder={lang === "ko" ? "작업번호 / 송장번호 검색" : "搜索订单号 / 运单号"} className="pl-8" />
          </div>
          <Select value={factoryFilter} onValueChange={v => setFactoryFilter(v as Factory | "all")}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === "ko" ? "전체 공장" : "全部工厂"}</SelectItem>
              {(Object.keys(factoryLabel) as Factory[]).map(f => (
                <SelectItem key={f} value={f}>{factoryLabel[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />{lang === "ko" ? "발주 등록" : "登记发货"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setHooksOpen(true)}>
            <Settings2 className="w-4 h-4 mr-1" />{lang === "ko" ? "위챗 Webhook 설정" : "企业微信 Webhook 设置"}
          </Button>
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
                <TableHead className="text-right min-w-[120px]">{lang === "ko" ? "위챗 발송" : "微信发送"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="secondary">{factoryLabel[r.factory]}</Badge></TableCell>
                  <TableCell className="font-medium">{r.order_no}</TableCell>
                  <TableCell className="text-right">{r.quantity.toLocaleString()}</TableCell>
                  <TableCell>{r.ordered_at}</TableCell>
                  {EDITABLE_DATE_FIELDS.map(field => (
                    <TableCell key={field}>
                      <Input type="date" value={r[field] ?? ""}
                        onChange={e => handleDateChange(r.id, field, e.target.value, r.status)}
                        className="h-8" />
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      <Select value={r.carrier ?? ""} onValueChange={v => persist(r.id, { carrier: v })}>
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue placeholder={lang === "ko" ? "택배사" : "快递"} />
                        </SelectTrigger>
                        <SelectContent>
                          {CARRIERS.map(c => (
                            <SelectItem key={c.value} value={c.value}>{lang === "ko" ? c.labelKo : c.labelZh}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={r.tracking_no ?? ""}
                        onChange={e => setRows(p => p.map(x => x.id === r.id ? { ...x, tracking_no: e.target.value } : x))}
                        onBlur={e => persist(r.id, { tracking_no: e.target.value || null })}
                        placeholder={lang === "ko" ? "송장번호" : "运单号"}
                        className="h-8 flex-1 min-w-[110px]" />
                      {r.tracking_no && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                          title={lang === "ko" ? "운송상태 조회" : "查询物流"}
                          onClick={() => openTracking(r.carrier, r.tracking_no)}>
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
                        {r.received_at && <span className="ml-1 text-[10px] opacity-70">{r.received_at}</span>}
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => confirmReceived(r.id)}>
                        {lang === "ko" ? "수령확인" : "确认收货"}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" disabled={sendingId === r.id} onClick={() => sendToWeChat(r)}>
                      {sendingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                      {lang === "ko" ? "위챗 발송" : "发送微信"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    {lang === "ko" ? "조회된 발주 이력이 없습니다." : "暂无发货历史。"}
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    {lang === "ko" ? "불러오는 중..." : "加载中..."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{lang === "ko" ? "발주 등록" : "登记发货"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{lang === "ko" ? "공장" : "工厂"}</Label>
              <Select value={draft.factory} onValueChange={v => setDraft(d => ({ ...d, factory: v as Factory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(factoryLabel) as Factory[]).map(f => (
                    <SelectItem key={f} value={f}>{factoryLabel[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{lang === "ko" ? "작업번호" : "作业号"}</Label>
                <Input value={draft.order_no} onChange={e => setDraft(d => ({ ...d, order_no: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{lang === "ko" ? "제품코드" : "产品编号"}</Label>
                <Input value={draft.product_code} onChange={e => setDraft(d => ({ ...d, product_code: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{lang === "ko" ? "수량" : "数量"}</Label>
                <Input type="number" value={draft.quantity} onChange={e => setDraft(d => ({ ...d, quantity: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{lang === "ko" ? "발주일" : "发单日期"}</Label>
                <Input type="date" value={draft.ordered_at} onChange={e => setDraft(d => ({ ...d, ordered_at: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{lang === "ko" ? "취소" : "取消"}</Button>
            <Button onClick={createOrder} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {lang === "ko" ? "등록" : "登记"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={hooksOpen} onOpenChange={setHooksOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{lang === "ko" ? "공장별 위챗 Webhook 설정" : "工厂企业微信 Webhook 设置"}</DialogTitle>
            <DialogDescription>
              {lang === "ko"
                ? "기업위챗(企业微信) 그룹채팅에서 '그룹봇 추가'로 발급받은 Webhook URL을 각 공장별로 등록하세요."
                : "在企业微信群聊中添加群机器人后获取 Webhook URL,按工厂分别填写。"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {(Object.keys(FACTORY_LABEL_KO) as Factory[]).map(f => (
              <div key={f} className="space-y-1.5">
                <Label className="text-xs">{factoryLabel[f]}</Label>
                <Input value={hooks[f] ?? ""}
                  onChange={e => setHooks(prev => ({ ...prev, [f]: e.target.value }))}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHooksOpen(false)}>{lang === "ko" ? "취소" : "取消"}</Button>
            <Button onClick={() => { saveHooks(hooks); setHooksOpen(false); }}>{lang === "ko" ? "저장" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useMemo, useState, useEffect, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import {
  CheckCircle2, Search, ExternalLink, Send, Settings2, Loader2, Plus,
  CalendarDays, Truck, Package, Hammer, Inbox, ImageIcon,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Factory = "silicon" | "heat" | "hologram" | "nfc" | "logo";
type Status = "ordered" | "shipped" | "received";
type Column = "ordered" | "started" | "produced" | "shipped" | "received";

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
  note: string | null;
  wechat_sent_at: string | null;
  us_due_at: string | null;
  image_url: string | null;
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
const FACTORY_DOT: Record<Factory, string> = {
  silicon: "hsl(205 75% 55%)",
  heat:    "hsl(15 80% 55%)",
  hologram:"hsl(280 60% 60%)",
  nfc:     "hsl(160 60% 45%)",
  logo:    "hsl(45 90% 55%)",
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

const COLUMNS: { key: Column; ko: string; zh: string; icon: any; color: string }[] = [
  { key: "ordered",  ko: "발주완료", zh: "已发单",  icon: Inbox,   color: "hsl(205 75% 55%)" },
  { key: "started",  ko: "제작착수", zh: "开始制作",icon: Hammer,  color: "hsl(45 90% 55%)" },
  { key: "produced", ko: "제작완료", zh: "制作完成",icon: Package, color: "hsl(160 60% 45%)" },
  { key: "shipped",  ko: "발송완료", zh: "已发货",  icon: Truck,   color: "hsl(280 60% 60%)" },
  { key: "received", ko: "수령확인", zh: "已收货",  icon: CheckCircle2, color: "hsl(140 65% 45%)" },
];

function deriveColumn(r: HistoryRow): Column {
  if (r.received_at || r.status === "received") return "received";
  if (r.shipped_at  || r.status === "shipped")  return "shipped";
  if (r.produced_at) return "produced";
  if (r.started_at)  return "started";
  return "ordered";
}

export default function OutsourceHistory() {
  const { lang } = useLang();
  const isKo = lang === "ko";
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
  const [draft, setDraft] = useState<{ factory: Factory; order_no: string; product_code: string; quantity: number; ordered_at: string; expected_at: string; us_due_at: string; image_url: string }>({
    factory: "silicon", order_no: "", product_code: "", quantity: 0,
    ordered_at: new Date().toISOString().slice(0, 10),
    expected_at: "", us_due_at: "", image_url: "",
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("outsource_orders")
      .select("*")
      .order("ordered_at", { ascending: false });
    if (error) {
      toast({ title: isKo ? "조회 실패" : "查询失败", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as HistoryRow[]);
    }
    setLoading(false);
  }, [isKo]);

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
    toast({ title: isKo ? "위챗 Webhook 저장 완료" : "已保存企业微信 Webhook" });
  };

  const factoryLabel = isKo ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH;

  const filtered = useMemo(() => rows.filter(r =>
    (factoryFilter === "all" || r.factory === factoryFilter) &&
    (!q
      || r.order_no.toLowerCase().includes(q.toLowerCase())
      || (r.tracking_no ?? "").toLowerCase().includes(q.toLowerCase())
      || (r.product_code ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, factoryFilter, q]);

  const grouped = useMemo(() => {
    const map: Record<Column, HistoryRow[]> = { ordered: [], started: [], produced: [], shipped: [], received: [] };
    for (const r of filtered) map[deriveColumn(r)].push(r);
    return map;
  }, [filtered]);

  const persist = async (id: string, patch: Partial<HistoryRow>) => {
    const prev = rows;
    setRows(p => p.map(r => r.id === id ? { ...r, ...patch } : r));
    const { error } = await supabase.from("outsource_orders").update(patch).eq("id", id);
    if (error) {
      setRows(prev);
      toast({ title: isKo ? "저장 실패" : "保存失败", description: error.message, variant: "destructive" });
    }
  };

  const confirmReceived = (id: string) => {
    persist(id, { status: "received", received_at: new Date().toISOString().slice(0, 10) });
    toast({ title: isKo ? "수령 확인 완료" : "已确认收货" });
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
      r.expected_at && `预计制作完成日 / 예상 제작 완료일: ${r.expected_at}`,
      r.us_due_at && `美国交期 / 미국 납기일: ${r.us_due_at}`,
      `——`,
      `请确认并按时交付。감사합니다.`,
    ].filter(Boolean);
    return lines.join("\n");
  };

  const sendToWeChat = async (r: HistoryRow) => {
    const url = hooks[r.factory]?.trim();
    if (!url) {
      toast({
        title: isKo ? "Webhook 미설정" : "未设置 Webhook",
        description: isKo ? `${FACTORY_LABEL_KO[r.factory]}의 위챗 Webhook을 먼저 등록하세요.` : `请先为 ${FACTORY_LABEL_ZH[r.factory]} 配置企业微信 Webhook。`,
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
      await persist(r.id, { wechat_sent_at: new Date().toISOString() });
      toast({ title: isKo ? "위챗 발송 완료 · 발주완료 카드 생성" : "已发送企业微信 · 已生成卡片" });
    } catch (e: any) {
      toast({ title: isKo ? "위챗 발송 실패" : "发送失败", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSendingId(null);
    }
  };

  const createOrder = async () => {
    if (!draft.order_no || !draft.product_code) {
      toast({ title: isKo ? "작업번호/제품코드를 입력하세요" : "请输入订单号/产品编号", variant: "destructive" });
      return;
    }
    setCreating(true);
    const { error } = await supabase.from("outsource_orders").insert({
      factory: draft.factory,
      order_no: draft.order_no,
      product_code: draft.product_code,
      quantity: draft.quantity,
      ordered_at: draft.ordered_at,
      expected_at: draft.expected_at || null,
      us_due_at: draft.us_due_at || null,
      image_url: draft.image_url || null,
      status: "ordered",
    });
    setCreating(false);
    if (error) {
      toast({ title: isKo ? "등록 실패" : "登记失败", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: isKo ? "발주 등록 완료" : "已登记发货" });
    setCreateOpen(false);
    setDraft({ factory: "silicon", order_no: "", product_code: "", quantity: 0, ordered_at: new Date().toISOString().slice(0, 10), expected_at: "", us_due_at: "", image_url: "" });
    loadRows();
  };

  const active = activeId ? rows.find(r => r.id === activeId) ?? null : null;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={isKo ? "발주 이력 관리 (보드)" : "发货历史管理 (看板)"}
        description={isKo
          ? "트렐로 스타일 칸반 보드 — 위챗 발송 시 ‘발주완료’ 컬럼에 카드가 생성되고, 단계별로 진행 상태를 추적합니다."
          : "Trello 风格看板 — 发送企业微信后即在 ‘已发单’ 列生成卡片,并按阶段追踪进度。"}
      />

      <Card className="p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)}
            placeholder={isKo ? "작업번호 / 송장번호 / 제품코드 검색" : "搜索订单号 / 运单号 / 产品编号"} className="pl-8" />
        </div>
        <Select value={factoryFilter} onValueChange={v => setFactoryFilter(v as Factory | "all")}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isKo ? "전체 공장" : "全部工厂"}</SelectItem>
            {(Object.keys(factoryLabel) as Factory[]).map(f => (
              <SelectItem key={f} value={f}>{factoryLabel[f]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />{isKo ? "발주 등록" : "登记发货"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setHooksOpen(true)}>
          <Settings2 className="w-4 h-4 mr-1" />{isKo ? "위챗 Webhook 설정" : "企业微信 Webhook 设置"}
        </Button>
      </Card>

      {/* Trello board */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {COLUMNS.map(col => {
          const Icon = col.icon;
          const items = grouped[col.key];
          return (
            <div key={col.key} className="rounded-lg border bg-muted/30 flex flex-col min-h-[420px]">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b sticky top-0 bg-muted/60 backdrop-blur rounded-t-lg">
                <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: `${col.color}25` }}>
                  <Icon className="w-4 h-4" style={{ color: col.color }} />
                </div>
                <span className="text-sm font-semibold flex-1">{isKo ? col.ko : col.zh}</span>
                <Badge variant="secondary" className="text-[10px]">{items.length}</Badge>
              </div>
              <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[68vh]">
                {items.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setActiveId(r.id)}
                    className="w-full text-left bg-card rounded-md border shadow-sm hover:shadow-md hover:border-primary/40 transition-all p-2.5 group"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FACTORY_DOT[r.factory] }} />
                      <span className="text-[10px] text-muted-foreground truncate flex-1">{factoryLabel[r.factory]}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{r.quantity.toLocaleString()}</span>
                    </div>
                    {r.image_url ? (
                      <img src={r.image_url} alt={r.order_no}
                        className="w-full h-24 object-cover rounded mb-2 bg-muted" loading="lazy" />
                    ) : (
                      <div className="w-full h-24 rounded mb-2 bg-muted flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="w-6 h-6 opacity-40" />
                      </div>
                    )}
                    <div className="text-xs font-semibold truncate">{r.order_no}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{r.product_code}</div>
                    <div className="flex flex-wrap items-center gap-1 mt-2">
                      <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
                        <CalendarDays className="w-3 h-3" />{r.ordered_at}
                      </Badge>
                      {r.us_due_at && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-destructive/40 text-destructive">
                          US {r.us_due_at}
                        </Badge>
                      )}
                      {r.wechat_sent_at && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary gap-1">
                          <Send className="w-3 h-3" />WeChat
                        </Badge>
                      )}
                    </div>
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="text-center text-[11px] text-muted-foreground py-6">
                    {isKo ? "카드 없음" : "暂无卡片"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="text-center text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />{isKo ? "불러오는 중..." : "加载中..."}
        </div>
      )}

      {/* Card detail dialog */}
      <Dialog open={!!active} onOpenChange={(v) => !v && setActiveId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: FACTORY_DOT[active.factory] }} />
                  {active.order_no}
                  <Badge variant="secondary" className="ml-2 text-[10px]">{factoryLabel[active.factory]}</Badge>
                </DialogTitle>
                <DialogDescription>
                  {isKo ? "제품코드" : "产品编号"}: <span className="font-mono">{active.product_code}</span> · {isKo ? "수량" : "数量"}: {active.quantity.toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              {active.image_url ? (
                <img src={active.image_url} alt={active.order_no} className="w-full max-h-64 object-contain rounded border bg-muted" />
              ) : (
                <div className="w-full h-40 rounded border bg-muted flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="w-8 h-8 opacity-40" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "발주일" : "发单日期"}</Label>
                  <Input type="date" value={active.ordered_at ?? ""} onChange={e => persist(active.id, { ordered_at: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "예상 제작 완료일" : "预计制作完成日"}</Label>
                  <Input type="date" value={active.expected_at ?? ""} onChange={e => persist(active.id, { expected_at: e.target.value || null })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "미국 납기일" : "美国交期"}</Label>
                  <Input type="date" value={active.us_due_at ?? ""} onChange={e => persist(active.id, { us_due_at: e.target.value || null })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "제작 착수" : "开始制作"}</Label>
                  <Input type="date" value={active.started_at ?? ""} onChange={e => persist(active.id, { started_at: e.target.value || null })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "제작완료" : "制作完成"}</Label>
                  <Input type="date" value={active.produced_at ?? ""} onChange={e => persist(active.id, { produced_at: e.target.value || null })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "발송일" : "发货日期"}</Label>
                  <Input type="date" value={active.shipped_at ?? ""} onChange={e => persist(active.id, { shipped_at: e.target.value || null, status: e.target.value && active.status === "ordered" ? "shipped" : active.status })} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "기본 이미지 URL (작업지시서)" : "基础图片 URL (作业指示书)"}</Label>
                <Input value={active.image_url ?? ""} placeholder="https://..." onChange={e => setRows(p => p.map(x => x.id === active.id ? { ...x, image_url: e.target.value } : x))} onBlur={e => persist(active.id, { image_url: e.target.value || null })} />
              </div>

              <div className="grid grid-cols-[120px_1fr_auto] gap-2 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "택배사" : "快递"}</Label>
                  <Select value={active.carrier ?? ""} onValueChange={v => persist(active.id, { carrier: v })}>
                    <SelectTrigger><SelectValue placeholder="-" /></SelectTrigger>
                    <SelectContent>
                      {CARRIERS.map(c => (
                        <SelectItem key={c.value} value={c.value}>{isKo ? c.labelKo : c.labelZh}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{isKo ? "송장번호" : "运单号"}</Label>
                  <Input value={active.tracking_no ?? ""}
                    onChange={e => setRows(p => p.map(x => x.id === active.id ? { ...x, tracking_no: e.target.value } : x))}
                    onBlur={e => persist(active.id, { tracking_no: e.target.value || null })} />
                </div>
                <Button variant="outline" size="icon" disabled={!active.tracking_no} onClick={() => openTracking(active.carrier, active.tracking_no)}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "메모" : "备注"}</Label>
                <Textarea rows={2} value={active.note ?? ""}
                  onChange={e => setRows(p => p.map(x => x.id === active.id ? { ...x, note: e.target.value } : x))}
                  onBlur={e => persist(active.id, { note: e.target.value || null })} />
              </div>

              {active.wechat_sent_at && (
                <div className="text-[11px] text-muted-foreground">
                  {isKo ? "위챗 발송 시각" : "微信发送时间"}: {new Date(active.wechat_sent_at).toLocaleString()}
                </div>
              )}

              <DialogFooter className="flex-wrap gap-2">
                {active.status !== "received" && (
                  <Button variant="outline" onClick={() => { confirmReceived(active.id); setActiveId(null); }}>
                    <CheckCircle2 className="w-4 h-4 mr-1" />{isKo ? "수령확인" : "确认收货"}
                  </Button>
                )}
                <Button onClick={() => sendToWeChat(active)} disabled={sendingId === active.id}>
                  {sendingId === active.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
                  {isKo ? "위챗 발송" : "发送微信"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isKo ? "발주 등록" : "登记发货"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{isKo ? "공장" : "工厂"}</Label>
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
                <Label className="text-xs">{isKo ? "작업번호" : "作业号"}</Label>
                <Input value={draft.order_no} onChange={e => setDraft(d => ({ ...d, order_no: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "제품코드" : "产品编号"}</Label>
                <Input value={draft.product_code} onChange={e => setDraft(d => ({ ...d, product_code: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "수량" : "数量"}</Label>
                <Input type="number" value={draft.quantity} onChange={e => setDraft(d => ({ ...d, quantity: Number(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "발주일" : "发单日期"}</Label>
                <Input type="date" value={draft.ordered_at} onChange={e => setDraft(d => ({ ...d, ordered_at: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "예상 제작 완료일" : "预计制作完成日"}</Label>
                <Input type="date" value={draft.expected_at} onChange={e => setDraft(d => ({ ...d, expected_at: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{isKo ? "미국 납기일" : "美国交期"}</Label>
                <Input type="date" value={draft.us_due_at} onChange={e => setDraft(d => ({ ...d, us_due_at: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{isKo ? "기본 이미지 URL (작업지시서)" : "基础图片 URL"}</Label>
              <Input value={draft.image_url} placeholder="https://..." onChange={e => setDraft(d => ({ ...d, image_url: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{isKo ? "취소" : "取消"}</Button>
            <Button onClick={createOrder} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {isKo ? "등록" : "登记"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Webhooks */}
      <Dialog open={hooksOpen} onOpenChange={setHooksOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isKo ? "공장별 위챗 Webhook 설정" : "工厂企业微信 Webhook 设置"}</DialogTitle>
            <DialogDescription>
              {isKo
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
            <Button variant="ghost" onClick={() => setHooksOpen(false)}>{isKo ? "취소" : "取消"}</Button>
            <Button onClick={() => { saveHooks(hooks); setHooksOpen(false); }}>{isKo ? "저장" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

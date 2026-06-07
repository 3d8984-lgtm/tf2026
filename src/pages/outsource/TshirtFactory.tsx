import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, CircleSlash, Package, Upload, X, FileText, Image as ImageIcon,
  PackageCheck, Filter, Download, Eye, ShoppingCart, Shirt, FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;
type Size = typeof SIZES[number];

type ProductType = { code: string; name_ko: string; name_zh: string; sort_order: number; active: boolean };
type Color = { code: string; name_ko: string; name_zh: string; hex: string; sort_order: number; active: boolean };
type Inventory = {
  id: string;
  product_type_code: string;
  color_code: string;
  size: Size;
  in_stock: number;
  in_progress: number;
  available: number;
  safety_stock: number;
};
type PO = {
  id: string;
  po_number: string;
  ordered_at: string;
  expected_at: string | null;
  received_at: string | null;
  product_type_code: string;
  color_code: string;
  status: "draft" | "ordered" | "in_production" | "received";
  notes: string | null;
  created_by_label: string | null;
  items?: { size: Size; quantity: number }[];
  attachments?: { id: string; file_name: string; file_path: string; mime_type: string | null }[];
};

const BUCKET = "tshirt-po-attachments";

function statusInfo(available: number, safety: number) {
  if (available <= 0) return { key: "out", color: "bg-zinc-500", label: "품절", icon: "⚫", text: "text-zinc-400" };
  const ratio = safety > 0 ? available / safety : 1;
  if (ratio < 0.5) return { key: "critical", color: "bg-red-500", label: "품절 임박", icon: "🔴", text: "text-red-500" };
  if (ratio < 1) return { key: "low", color: "bg-yellow-500", label: "재고 부족", icon: "🟡", text: "text-yellow-500" };
  return { key: "ok", color: "bg-emerald-500", label: "정상", icon: "🟢", text: "text-emerald-500" };
}

function poStatusBadge(status: PO["status"]) {
  const map: Record<PO["status"], { label: string; variant: any }> = {
    draft: { label: "임시 저장", variant: "outline" },
    ordered: { label: "발주 완료", variant: "secondary" },
    in_production: { label: "생산 중", variant: "default" },
    received: { label: "입고 완료", variant: "default" },
  };
  return map[status];
}

export default function TshirtFactory() {
  const { lang } = useLang();
  const { user } = useAuth();
  const [tab, setTab] = useState("inventory");
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [filterType, setFilterType] = useState<string>("all");
  const [filterColor, setFilterColor] = useState<string>("all");
  const [filterSize, setFilterSize] = useState<string>("all");
  const [onlyWarning, setOnlyWarning] = useState(false);

  const [skuDetail, setSkuDetail] = useState<Inventory | null>(null);
  const [poDetail, setPoDetail] = useState<PO | null>(null);

  // PO form prefill
  const [prefillType, setPrefillType] = useState<string | null>(null);
  const [prefillColor, setPrefillColor] = useState<string | null>(null);
  const [prefillSize, setPrefillSize] = useState<Size | null>(null);

  // PO list filters
  const [poStatusFilter, setPoStatusFilter] = useState<string>("all");
  const [poFrom, setPoFrom] = useState<string>("");
  const [poTo, setPoTo] = useState<string>("");

  const nameOf = (t: { name_ko: string; name_zh: string }) => (lang === "zh" ? t.name_zh : t.name_ko);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [pt, co, inv, po, poi, att] = await Promise.all([
      supabase.from("tshirt_product_types").select("*").eq("active", true).order("sort_order"),
      supabase.from("tshirt_colors").select("*").eq("active", true).order("sort_order"),
      supabase.from("tshirt_inventory").select("*"),
      supabase.from("tshirt_purchase_orders").select("*").order("ordered_at", { ascending: false }),
      supabase.from("tshirt_purchase_order_items").select("*"),
      supabase.from("tshirt_purchase_order_attachments").select("*"),
    ]);
    setProductTypes((pt.data as any) ?? []);
    setColors((co.data as any) ?? []);
    setInventory((inv.data as any) ?? []);
    const items = (poi.data as any[]) ?? [];
    const atts = (att.data as any[]) ?? [];
    const merged = ((po.data as any[]) ?? []).map(p => ({
      ...p,
      items: items.filter(i => i.po_id === p.id).map(i => ({ size: i.size, quantity: i.quantity })),
      attachments: atts.filter(a => a.po_id === p.id),
    })) as PO[];
    setPos(merged);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const invMap = useMemo(() => {
    const m = new Map<string, Inventory>();
    for (const i of inventory) m.set(`${i.product_type_code}|${i.color_code}|${i.size}`, i);
    return m;
  }, [inventory]);

  const kpi = useMemo(() => {
    let ok = 0, low = 0, critical = 0, out = 0;
    for (const i of inventory) {
      const s = statusInfo(i.available, i.safety_stock).key;
      if (s === "ok") ok++; else if (s === "low") low++; else if (s === "critical") critical++; else out++;
    }
    return { ok, low, critical, out };
  }, [inventory]);

  const warnings = useMemo(() => {
    return inventory
      .filter(i => statusInfo(i.available, i.safety_stock).key !== "ok")
      .sort((a, b) => (a.available / Math.max(1, a.safety_stock)) - (b.available / Math.max(1, b.safety_stock)));
  }, [inventory]);

  const visibleTypes = useMemo(() => {
    if (filterType === "all") return productTypes;
    return productTypes.filter(t => t.code === filterType);
  }, [productTypes, filterType]);

  const visibleColors = useMemo(() => {
    if (filterColor === "all") return colors;
    return colors.filter(c => c.code === filterColor);
  }, [colors, filterColor]);

  const visibleSizes: readonly Size[] = filterSize === "all" ? SIZES : ([filterSize as Size]);

  const goPurchase = (typeCode: string, colorCode: string, size?: Size) => {
    setPrefillType(typeCode);
    setPrefillColor(colorCode);
    setPrefillSize(size ?? null);
    setTab("create");
  };

  const filteredPos = useMemo(() => {
    return pos.filter(p => {
      if (poStatusFilter !== "all" && p.status !== poStatusFilter) return false;
      if (poFrom && p.ordered_at < poFrom) return false;
      if (poTo && p.ordered_at > poTo) return false;
      return true;
    });
  }, [pos, poStatusFilter, poFrom, poTo]);

  const downloadCsv = () => {
    const headers = ["발주번호", "발주일", "예상입고일", "실제입고일", "종류", "색상", ...SIZES, "총수량", "상태"];
    const rows = filteredPos.map(p => {
      const sizeMap = new Map(p.items?.map(i => [i.size, i.quantity]));
      const total = (p.items ?? []).reduce((s, i) => s + i.quantity, 0);
      const pt = productTypes.find(t => t.code === p.product_type_code);
      const c = colors.find(c => c.code === p.color_code);
      return [
        p.po_number, p.ordered_at, p.expected_at ?? "", p.received_at ?? "",
        pt ? nameOf(pt) : p.product_type_code, c ? nameOf(c) : p.color_code,
        ...SIZES.map(s => sizeMap.get(s) ?? 0), total, poStatusBadge(p.status).label,
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tshirt-po-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const markReceived = async (po: PO) => {
    const { error } = await supabase
      .from("tshirt_purchase_orders")
      .update({ status: "received", received_at: new Date().toISOString().slice(0, 10) })
      .eq("id", po.id);
    if (error) { toast({ title: "입고 처리 실패", description: error.message, variant: "destructive" }); return; }
    toast({ title: "입고 완료", description: `${po.po_number} 재고에 반영되었습니다.` });
    loadAll();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Shirt className="w-6 h-6" /> 티셔츠 공장</h1>
          <p className="text-sm text-muted-foreground">티셔츠 재고 현황 및 발주 관리</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inventory">재고 현황 & 발주 목록</TabsTrigger>
          <TabsTrigger value="create">발주 지시</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory" className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiTile icon={<CheckCircle2 className="w-5 h-5" />} label="정상 재고" value={kpi.ok} accent="text-emerald-500" dot="bg-emerald-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="재고 부족" value={kpi.low} accent="text-yellow-500" dot="bg-yellow-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="품절 임박" value={kpi.critical} accent="text-red-500" dot="bg-red-500" />
            <KpiTile icon={<CircleSlash className="w-5 h-5" />} label="품절" value={kpi.out} accent="text-zinc-400" dot="bg-zinc-500" />
          </div>

          {/* Safety stock setting & warnings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-4 h-4 text-yellow-500" /> 안전 재고 설정 및 경고
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="warnings">
                <TabsList>
                  <TabsTrigger value="settings">안전재고 설정</TabsTrigger>
                  <TabsTrigger value="warnings">안전 재고 경고 ({warnings.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="settings" className="pt-3">
                  <SafetyStockSettings
                    productTypes={productTypes}
                    colors={colors}
                    invMap={invMap}
                    nameOf={nameOf}
                    onSaved={loadAll}
                  />
                </TabsContent>
                <TabsContent value="warnings" className="pt-3">
                  {warnings.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-6 text-center">경고 항목이 없습니다.</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y">
                      {warnings.slice(0, 20).map(w => {
                        const pt = productTypes.find(t => t.code === w.product_type_code);
                        const c = colors.find(c => c.code === w.color_code);
                        const s = statusInfo(w.available, w.safety_stock);
                        return (
                          <div key={w.id} className="flex items-center justify-between py-2 gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${s.color}`} />
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate text-red-600">
                                  {pt ? nameOf(pt) : w.product_type_code} · {c ? nameOf(c) : w.color_code} · {w.size}
                                </div>
                                <div className="text-xs text-red-600">
                                  가용 {w.available} / 안전 {w.safety_stock}
                                </div>
                              </div>
                            </div>
                            <Button size="sm" onClick={() => goPurchase(w.product_type_code, w.color_code, w.size)}>
                              <ShoppingCart className="w-3.5 h-3.5 mr-1" /> 발주하기
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>


          {/* Filters */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-40"><SelectValue placeholder="상품 유형" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 유형</SelectItem>
                  {productTypes.map(t => <SelectItem key={t.code} value={t.code}>{nameOf(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterColor} onValueChange={setFilterColor}>
                <SelectTrigger className="w-36"><SelectValue placeholder="색상" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 색상</SelectItem>
                  {colors.map(c => <SelectItem key={c.code} value={c.code}>{nameOf(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterSize} onValueChange={setFilterSize}>
                <SelectTrigger className="w-32"><SelectValue placeholder="사이즈" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 사이즈</SelectItem>
                  {SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-sm text-muted-foreground">경고만 보기</span>
                <Switch checked={onlyWarning} onCheckedChange={setOnlyWarning} />
              </div>
            </CardContent>
          </Card>

          {/* Inventory matrix per product type */}
          {loading ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">불러오는 중...</CardContent></Card>
          ) : visibleTypes.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">상품이 없습니다.</CardContent></Card>
          ) : visibleTypes.map(pt => (
            <Card key={pt.code}>
              <CardHeader>
                <CardTitle className="text-base">{nameOf(pt)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-32">색상</TableHead>
                        {visibleSizes.map(s => <TableHead key={s} className="text-center">{s}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleColors.map(c => {
                        const rowCells = visibleSizes.map(s => invMap.get(`${pt.code}|${c.code}|${s}`));
                        if (onlyWarning && rowCells.every(i => !i || statusInfo(i.available, i.safety_stock).key === "ok")) return null;
                        return (
                          <TableRow key={c.code}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <span className="inline-block w-3 h-3 rounded-full border" style={{ background: c.hex }} />
                                {nameOf(c)}
                              </div>
                            </TableCell>
                            {visibleSizes.map((s, idx) => {
                              const inv = rowCells[idx];
                              if (!inv) return <TableCell key={s} className="text-center text-muted-foreground">-</TableCell>;
                              const st = statusInfo(inv.available, inv.safety_stock);
                              const pct = inv.safety_stock > 0 ? Math.min(100, (inv.available / inv.safety_stock) * 100) : 100;
                              const show = !onlyWarning || st.key !== "ok";
                              if (!show) return <TableCell key={s} />;
                              return (
                                <TableCell key={s} className="text-center cursor-pointer hover:bg-muted/50" onClick={() => setSkuDetail(inv)}>
                                  <div className={`text-lg font-semibold ${st.text}`}>{inv.available} <span className="text-xs">{st.icon}</span></div>
                                  <div className="h-1.5 mt-1 rounded bg-muted overflow-hidden">
                                    <div className={`h-full ${st.color}`} style={{ width: `${pct}%` }} />
                                  </div>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* PO List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><Package className="w-4 h-4" /> 발주 목록</span>
                <Button size="sm" variant="outline" onClick={downloadCsv}><Download className="w-3.5 h-3.5 mr-1" /> CSV</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Select value={poStatusFilter} onValueChange={setPoStatusFilter}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="상태" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 상태</SelectItem>
                    <SelectItem value="ordered">발주 완료</SelectItem>
                    <SelectItem value="in_production">생산 중</SelectItem>
                    <SelectItem value="received">입고 완료</SelectItem>
                    <SelectItem value="draft">임시 저장</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" className="w-40" value={poFrom} onChange={e => setPoFrom(e.target.value)} />
                <span className="text-muted-foreground">~</span>
                <Input type="date" className="w-40" value={poTo} onChange={e => setPoTo(e.target.value)} />
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>발주번호</TableHead>
                      <TableHead>발주일</TableHead>
                      <TableHead>예상 입고</TableHead>
                      <TableHead>실제 입고</TableHead>
                      <TableHead>종류 / 색상</TableHead>
                      {SIZES.map(s => <TableHead key={s} className="text-center text-xs">{s}</TableHead>)}
                      <TableHead className="text-center">합계</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="text-right">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPos.length === 0 && (
                      <TableRow><TableCell colSpan={14} className="text-center py-8 text-muted-foreground">발주 내역이 없습니다.</TableCell></TableRow>
                    )}
                    {filteredPos.map(p => {
                      const sizeMap = new Map(p.items?.map(i => [i.size, i.quantity]));
                      const total = (p.items ?? []).reduce((s, i) => s + i.quantity, 0);
                      const pt = productTypes.find(t => t.code === p.product_type_code);
                      const c = colors.find(c => c.code === p.color_code);
                      const st = poStatusBadge(p.status);
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.po_number}</TableCell>
                          <TableCell className="text-xs">{p.ordered_at}</TableCell>
                          <TableCell className="text-xs">{p.expected_at ?? "-"}</TableCell>
                          <TableCell className="text-xs">{p.received_at ?? <span className="text-muted-foreground">대기 중</span>}</TableCell>
                          <TableCell className="text-xs">{pt ? nameOf(pt) : p.product_type_code} / {c ? nameOf(c) : p.color_code}</TableCell>
                          {SIZES.map(s => <TableCell key={s} className="text-center text-xs">{sizeMap.get(s) || ""}</TableCell>)}
                          <TableCell className="text-center font-semibold">{total}</TableCell>
                          <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            <Button size="sm" variant="ghost" onClick={() => setPoDetail(p)}><Eye className="w-3.5 h-3.5" /></Button>
                            {p.status !== "received" && (
                              <Button size="sm" variant="outline" onClick={() => markReceived(p)}>
                                <PackageCheck className="w-3.5 h-3.5 mr-1" /> 입고
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create">
          <PurchaseOrderForm
            productTypes={productTypes}
            colors={colors}
            invMap={invMap}
            prefillType={prefillType}
            prefillColor={prefillColor}
            authorLabel={user?.email || ""}
            userId={user?.id ?? null}
            nameOf={nameOf}
            onReload={loadAll}
            onDone={() => { setTab("inventory"); loadAll(); }}
          />
        </TabsContent>
      </Tabs>

      {/* SKU detail dialog */}
      <Dialog open={!!skuDetail} onOpenChange={o => !o && setSkuDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>SKU 상세</DialogTitle></DialogHeader>
          {skuDetail && (() => {
            const pt = productTypes.find(t => t.code === skuDetail.product_type_code);
            const c = colors.find(c => c.code === skuDetail.color_code);
            const st = statusInfo(skuDetail.available, skuDetail.safety_stock);
            return (
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">{pt ? nameOf(pt) : ""}</span> · {c ? nameOf(c) : ""} · <span className="font-mono">{skuDetail.size}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label="입고 재고" value={skuDetail.in_stock} />
                  <Stat label="작업 중 재고" value={skuDetail.in_progress} />
                  <Stat label="실 가용 재고" value={skuDetail.available} accent={st.text} />
                  <Stat label="안전 재고" value={skuDetail.safety_stock} />
                </div>
                <div className={`text-sm flex items-center gap-2 ${st.text}`}>{st.icon} {st.label}</div>
                <Button onClick={() => { goPurchase(skuDetail.product_type_code, skuDetail.color_code, skuDetail.size); setSkuDetail(null); }}>
                  <ShoppingCart className="w-4 h-4 mr-1" /> 이 색상 발주하기
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* PO detail dialog */}
      <Dialog open={!!poDetail} onOpenChange={o => !o && setPoDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>발주 상세 {poDetail?.po_number}</DialogTitle></DialogHeader>
          {poDetail && <PoDetailView po={poDetail} productTypes={productTypes} colors={colors} nameOf={nameOf} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiTile({ icon, label, value, accent, dot }: any) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        <div className={accent}>{icon}</div>
        <div className="flex-1">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-2xl font-bold ${accent}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="border rounded p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function PoDetailView({ po, productTypes, colors, nameOf }: {
  po: PO; productTypes: ProductType[]; colors: Color[]; nameOf: (t: any) => string;
}) {
  const pt = productTypes.find(t => t.code === po.product_type_code);
  const c = colors.find(c => c.code === po.color_code);
  const st = poStatusBadge(po.status);
  const total = (po.items ?? []).reduce((s, i) => s + i.quantity, 0);

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      const next: Record<string, string> = {};
      for (const a of po.attachments ?? []) {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.file_path, 3600);
        if (data?.signedUrl) next[a.id] = data.signedUrl;
      }
      setUrls(next);
    })();
  }, [po.id]);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <div><span className="text-muted-foreground">발주일:</span> {po.ordered_at}</div>
        <div><span className="text-muted-foreground">예상 입고일:</span> {po.expected_at ?? "-"}</div>
        <div><span className="text-muted-foreground">실제 입고일:</span> {po.received_at ?? "-"}</div>
        <div><span className="text-muted-foreground">상태:</span> <Badge variant={st.variant}>{st.label}</Badge></div>
        <div><span className="text-muted-foreground">종류:</span> {pt ? nameOf(pt) : po.product_type_code}</div>
        <div><span className="text-muted-foreground">색상:</span> {c ? nameOf(c) : po.color_code}</div>
        <div><span className="text-muted-foreground">작성자:</span> {po.created_by_label ?? "-"}</div>
        <div><span className="text-muted-foreground">총 수량:</span> <b>{total}</b></div>
      </div>

      <div>
        <div className="font-medium mb-2">사이즈별 수량</div>
        <div className="grid grid-cols-7 gap-2">
          {SIZES.map(s => {
            const q = po.items?.find(i => i.size === s)?.quantity ?? 0;
            return <div key={s} className="border rounded p-2 text-center">
              <div className="text-xs text-muted-foreground">{s}</div>
              <div className="font-semibold">{q}</div>
            </div>;
          })}
        </div>
      </div>

      {po.notes && (
        <div>
          <div className="font-medium mb-1">특이사항</div>
          <div className="whitespace-pre-wrap text-muted-foreground border rounded p-2">{po.notes}</div>
        </div>
      )}

      {(po.attachments ?? []).length > 0 && (
        <div>
          <div className="font-medium mb-2">참고 도면 ({po.attachments?.length})</div>
          <div className="grid grid-cols-3 gap-2">
            {po.attachments?.map(a => {
              const url = urls[a.id];
              const isImg = (a.mime_type ?? "").startsWith("image/");
              return (
                <a key={a.id} href={url} target="_blank" rel="noreferrer" className="border rounded p-2 hover:bg-muted text-xs">
                  {isImg && url
                    ? <img src={url} alt={a.file_name} className="w-full h-24 object-cover rounded mb-1" />
                    : <div className="h-24 flex items-center justify-center bg-muted rounded mb-1"><FileText className="w-6 h-6" /></div>}
                  <div className="truncate">{a.file_name}</div>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PurchaseOrderForm({
  productTypes, colors, invMap, prefillType, prefillColor, authorLabel, userId, nameOf, onReload, onDone,
}: {
  productTypes: ProductType[];
  colors: Color[];
  invMap: Map<string, Inventory>;
  prefillType: string | null;
  prefillColor: string | null;
  authorLabel: string;
  userId: string | null;
  nameOf: (t: any) => string;
  onReload: () => void | Promise<void>;
  onDone: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const LS_KEY = "tshirt.workOrder.v1.draft";
  const [orderedAt, setOrderedAt] = useState(today);
  const [expectedAt, setExpectedAt] = useState("");
  const [author, setAuthor] = useState(authorLabel);
  const [company, setCompany] = useState("TWINMETA");
  const [jobNo, setJobNo] = useState("");
  const [recipient, setRecipient] = useState("TWINMETA");
  const [phone, setPhone] = useState("18562757070");
  const [address, setAddress] = useState("山东省 青岛市 城阳区 青岛市城阳区流亭街道杨埠寨社区工业园6号厂房东侧1楼 TWINMETA");
  const [fabricName, setFabricName] = useState("");
  const [fabricWeight, setFabricWeight] = useState("");
  const [garmentType, setGarmentType] = useState("");
  const [typeCode, setTypeCode] = useState<string>("");
  // qty per color × size
  const emptyQty = () => Object.fromEntries(SIZES.map(s => [s, 0])) as Record<Size, number>;
  const [qtyByColor, setQtyByColor] = useState<Record<string, Record<Size, number>>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newTypeCode, setNewTypeCode] = useState("");
  const [newTypeKo, setNewTypeKo] = useState("");
  const [newTypeZh, setNewTypeZh] = useState("");
  const [addingType, setAddingType] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load saved defaults
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      if (raw) {
        const d = JSON.parse(raw);
        if (d.company) setCompany(d.company);
        if (d.recipient) setRecipient(d.recipient);
        if (d.phone) setPhone(d.phone);
        if (d.address) setAddress(d.address);
        if (d.fabricName) setFabricName(d.fabricName);
        if (d.fabricWeight) setFabricWeight(d.fabricWeight);
        if (d.garmentType) setGarmentType(d.garmentType);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ company, recipient, phone, address, fabricName, fabricWeight, garmentType })); } catch { /* */ }
  }, [company, recipient, phone, address, fabricName, fabricWeight, garmentType]);

  useEffect(() => { setAuthor(authorLabel); }, [authorLabel]);
  useEffect(() => {
    if (prefillType) setTypeCode(prefillType);
    else if (productTypes[0] && !typeCode) setTypeCode(productTypes[0].code);
  }, [prefillType, productTypes]);
  useEffect(() => {
    if (prefillColor) {
      setQtyByColor(prev => ({ ...prev, [prefillColor]: prev[prefillColor] ?? emptyQty() }));
    }
  }, [prefillColor]);
  // ensure all colors have a row
  useEffect(() => {
    setQtyByColor(prev => {
      const next = { ...prev };
      for (const c of colors) if (!next[c.code]) next[c.code] = emptyQty();
      return next;
    });
  }, [colors]);

  const colorTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of colors) m[c.code] = SIZES.reduce((s, k) => s + (Number(qtyByColor[c.code]?.[k]) || 0), 0);
    return m;
  }, [qtyByColor, colors]);
  const sizeTotals = useMemo(() => {
    const m = Object.fromEntries(SIZES.map(s => [s, 0])) as Record<Size, number>;
    for (const c of colors) for (const s of SIZES) m[s] += Number(qtyByColor[c.code]?.[s]) || 0;
    return m;
  }, [qtyByColor, colors]);
  const total = useMemo(() => Object.values(colorTotals).reduce((s, v) => s + v, 0), [colorTotals]);

  const setQty = (colorCode: string, size: Size, v: number) => {
    setQtyByColor(prev => ({
      ...prev,
      [colorCode]: { ...(prev[colorCode] ?? emptyQty()), [size]: Math.max(0, v) },
    }));
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).filter(f => /image\/(png|jpe?g)|application\/pdf/i.test(f.type));
    setFiles(prev => [...prev, ...arr]);
  };

  const buildNotesWithMeta = () => {
    const meta: string[] = [];
    if (garmentType) meta.push(`의류 종류: ${garmentType}`);
    if (fabricName) meta.push(`원단: ${fabricName}`);
    if (fabricWeight) meta.push(`원단 중량: ${fabricWeight}`);
    const metaLine = meta.length ? `[${meta.join(" / ")}]\n` : "";
    return (metaLine + (notes || "")).trim() || null;
  };

  const submit = async (status: "draft" | "ordered") => {
    if (!typeCode) { toast({ title: "티셔츠 종류를 선택하세요", variant: "destructive" }); return; }
    const activeColors = colors.filter(c => colorTotals[c.code] > 0);
    if (status === "ordered" && activeColors.length === 0) {
      toast({ title: "색상별 수량을 1개 이상 입력하세요", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      // If draft and no quantities, save a single empty PO under first color
      const targets = activeColors.length > 0 ? activeColors : [colors[0]];
      const createdNumbers: string[] = [];
      const fullNotes = buildNotesWithMeta();

      for (const c of targets) {
        const { data: po, error } = await supabase
          .from("tshirt_purchase_orders")
          .insert({
            ordered_at: orderedAt,
            expected_at: expectedAt || null,
            product_type_code: typeCode,
            color_code: c.code,
            status,
            notes: fullNotes,
            created_by: userId,
            created_by_label: author || null,
          })
          .select()
          .single();
        if (error) throw error;
        createdNumbers.push(po.po_number);

        const items = SIZES
          .map(s => ({ po_id: po.id, size: s, quantity: Number(qtyByColor[c.code]?.[s]) || 0 }))
          .filter(i => i.quantity > 0);
        if (items.length > 0) {
          const { error: e2 } = await supabase.from("tshirt_purchase_order_items").insert(items);
          if (e2) throw e2;
        }

        for (const f of files) {
          const path = `${po.id}/${Date.now()}__${f.name}`;
          const { error: ue } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false, contentType: f.type });
          if (ue) throw ue;
          await supabase.from("tshirt_purchase_order_attachments").insert({
            po_id: po.id, file_path: path, file_name: f.name, mime_type: f.type, size_bytes: f.size,
          });
        }
      }

      toast({
        title: status === "draft" ? "임시 저장 완료" : "발주가 등록되었습니다",
        description: createdNumbers.join(", "),
      });
      onDone();
    } catch (e: any) {
      toast({ title: "저장 실패", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const addProductType = async () => {
    const code = newTypeCode.trim().toUpperCase().replace(/\s+/g, "_");
    const ko = newTypeKo.trim();
    if (!code || !ko) { toast({ title: "코드와 한국어 이름을 입력하세요", variant: "destructive" }); return; }
    setAddingType(true);
    try {
      const maxOrder = productTypes.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0);
      const { error } = await supabase.from("tshirt_product_types").insert({
        code, name_ko: ko, name_zh: newTypeZh.trim() || ko, sort_order: maxOrder + 10, active: true,
      });
      if (error) throw error;
      toast({ title: "티셔츠 종류가 추가되었습니다", description: ko });
      setNewTypeCode(""); setNewTypeKo(""); setNewTypeZh("");
      setAddTypeOpen(false);
      await onReload();
      setTypeCode(code);
    } catch (e: any) {
      toast({ title: "추가 실패", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setAddingType(false);
    }
  };

  const typeName = productTypes.find(t => t.code === typeCode) ? nameOf(productTypes.find(t => t.code === typeCode)!) : "";

  const downloadExcel = () => {
    const head1 = ["발 주 서 (PURCHASE ORDER)"];
    const rows: any[][] = [
      head1,
      [],
      ["발주업체명", company, "", "작업번호", jobNo || ""],
      ["발주일", orderedAt, "", "납품일", expectedAt || ""],
      ["받을사람", recipient, "", "전화번호", phone],
      ["주소", address],
      ["작성자", author, "", "총수량", total],
      ["의류 종류", garmentType || "", "", "티셔츠 종류", typeName],
      ["원단 이름", fabricName || "", "", "원단 중량", fabricWeight || ""],
      [],
      ["색상별 수량"],
      ["색상", ...SIZES, "합계"],
    ];
    for (const c of colors) {
      rows.push([nameOf(c), ...SIZES.map(s => qtyByColor[c.code]?.[s] || 0), colorTotals[c.code] || 0]);
    }
    rows.push(["사이즈 합계", ...SIZES.map(s => sizeTotals[s] || 0), total]);
    rows.push([]);
    rows.push(["발주 특이사항"]);
    rows.push([notes || ""]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const colCount = SIZES.length + 2;
    ws["!cols"] = [{ wch: 16 }, ...SIZES.map(() => ({ wch: 8 })), { wch: 10 }];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
      { s: { r: 5, c: 1 }, e: { r: 5, c: colCount - 1 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "발주서");
    const fname = `발주서_${jobNo || orderedAt}_${typeName || "tshirt"}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast({ title: "엑셀 다운로드 완료", description: fname });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">① 기본 정보</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">발주업체명</label>
            <Input value={company} onChange={e => setCompany(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">작업번호</label>
            <Input value={jobNo} onChange={e => setJobNo(e.target.value)} placeholder="자동 생성 (발주 등록 시)" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">작성자</label>
            <Input value={author} onChange={e => setAuthor(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">발주일</label>
            <Input type="date" value={orderedAt} onChange={e => setOrderedAt(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">납품일 (예상 입고일)</label>
            <Input type="date" value={expectedAt} onChange={e => setExpectedAt(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">총수량</label>
            <Input value={total} readOnly className="bg-muted" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">받을사람</label>
            <Input value={recipient} onChange={e => setRecipient(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">전화번호</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">의류 종류</label>
            <Input value={garmentType} onChange={e => setGarmentType(e.target.value)} placeholder="예: 반팔 라운드넥" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">원단 이름</label>
            <Input value={fabricName} onChange={e => setFabricName(e.target.value)} placeholder="예: 30수 싱글 코마사" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">원단 중량</label>
            <Input value={fabricWeight} onChange={e => setFabricWeight(e.target.value)} placeholder="예: 180g/㎡" />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-muted-foreground">주소</label>
            <Input value={address} onChange={e => setAddress(e.target.value)} />
          </div>
          <div className="md:col-span-3">
            <label className="text-xs text-muted-foreground">발주 특이사항</label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 1000))}
              placeholder="예: 원단 변경 요청, 납기 조정, 포장 방식 등 특이사항을 입력하세요"
              rows={3}
            />
            <div className="text-xs text-right text-muted-foreground mt-1">{notes.length} / 1000</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">② 상품 선택</CardTitle></CardHeader>
        <CardContent>
          <label className="text-xs text-muted-foreground">티셔츠 종류</label>
          <div className="flex gap-2 mt-1">
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {productTypes.map(t => <SelectItem key={t.code} value={t.code}>{nameOf(t)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setAddTypeOpen(true)}>+ 종류 추가</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">③ 색상별 수량 입력 (현재 재고 참고)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">색상</TableHead>
                  {SIZES.map(s => <TableHead key={s} className="text-center">{s}</TableHead>)}
                  <TableHead className="text-right w-20">합계</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {colors.map(c => (
                  <TableRow key={c.code}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full border shrink-0" style={{ background: c.hex }} />
                        {nameOf(c)}
                      </div>
                    </TableCell>
                    {SIZES.map(s => {
                      const inv = typeCode ? invMap.get(`${typeCode}|${c.code}|${s}`) : undefined;
                      const st = inv ? statusInfo(inv.available, inv.safety_stock) : null;
                      const low = st && st.key !== "ok";
                      return (
                        <TableCell key={s} className="p-1">
                          <Input
                            type="number" min={0}
                            value={qtyByColor[c.code]?.[s] ?? 0}
                            onChange={e => setQty(c.code, s, Number(e.target.value) || 0)}
                            className="text-right h-8 px-2"
                          />
                          <div className={`text-[10px] text-center mt-0.5 ${low ? "text-yellow-500" : "text-muted-foreground"}`}>
                            재고 {inv?.available ?? "-"} / 안전 {inv?.safety_stock ?? "-"}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-semibold">{colorTotals[c.code] || 0}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold text-right">사이즈 합계</TableCell>
                  {SIZES.map(s => (
                    <TableCell key={s} className="text-center font-semibold">{sizeTotals[s] || 0}</TableCell>
                  ))}
                  <TableCell className="text-right font-bold text-lg">{total}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">④ 참고 도면 업로드</CardTitle></CardHeader>
        <CardContent>
          <div
            className="border-2 border-dashed rounded p-6 text-center text-sm text-muted-foreground cursor-pointer hover:bg-muted/30"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
          >
            <Upload className="w-6 h-6 mx-auto mb-2" />
            파일을 끌어다 놓거나 클릭하여 업로드 (PNG, JPG, PDF)
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,application/pdf" hidden onChange={e => onFiles(e.target.files)} />
          </div>
          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {files.map((f, i) => {
                const isImg = f.type.startsWith("image/");
                const url = isImg ? URL.createObjectURL(f) : "";
                return (
                  <div key={i} className="relative border rounded p-2 text-xs">
                    <button type="button" className="absolute top-1 right-1 bg-background border rounded-full p-0.5" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}>
                      <X className="w-3 h-3" />
                    </button>
                    {isImg
                      ? <img src={url} alt={f.name} className="w-full h-20 object-cover rounded mb-1" />
                      : <div className="h-20 flex items-center justify-center bg-muted rounded mb-1"><FileText className="w-6 h-6" /></div>}
                    <div className="truncate">{f.name}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setPreviewOpen(true)}>
          <Eye className="w-4 h-4 mr-1" />발주서 미리보기
        </Button>
        <Button variant="outline" onClick={() => downloadExcel()}>
          <FileSpreadsheet className="w-4 h-4 mr-1" />엑셀 다운로드
        </Button>
        <Button variant="outline" disabled={saving} onClick={() => submit("draft")}>임시 저장</Button>
        <Button disabled={saving} onClick={() => submit("ordered")}>발주 등록</Button>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>발주서 미리보기</DialogTitle></DialogHeader>
          <PurchaseOrderPreview
            company={company} jobNo={jobNo} author={author}
            orderedAt={orderedAt} expectedAt={expectedAt}
            recipient={recipient} phone={phone} address={address}
            garmentType={garmentType} fabricName={fabricName} fabricWeight={fabricWeight}
            typeName={typeName}
            colors={colors} nameOf={nameOf}
            qtyByColor={qtyByColor} colorTotals={colorTotals} sizeTotals={sizeTotals}
            total={total} notes={notes}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => downloadExcel()}>
              <FileSpreadsheet className="w-4 h-4 mr-1" />엑셀 다운로드
            </Button>
            <Button variant="outline" onClick={() => window.print()}>인쇄</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addTypeOpen} onOpenChange={setAddTypeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>티셔츠 종류 추가</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">코드 (영문/숫자, 예: LONG_SLEEVE)</label>
              <Input value={newTypeCode} onChange={e => setNewTypeCode(e.target.value)} placeholder="LONG_SLEEVE" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">한국어 이름</label>
              <Input value={newTypeKo} onChange={e => setNewTypeKo(e.target.value)} placeholder="긴팔 티셔츠" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">중국어 이름 (선택)</label>
              <Input value={newTypeZh} onChange={e => setNewTypeZh(e.target.value)} placeholder="长袖T恤" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddTypeOpen(false)}>취소</Button>
              <Button disabled={addingType} onClick={addProductType}>추가</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PurchaseOrderPreview({
  company, jobNo, author, orderedAt, expectedAt, recipient, phone, address,
  garmentType, fabricName, fabricWeight, typeName,
  colors, nameOf, qtyByColor, colorTotals, sizeTotals, total, notes,
}: {
  company: string; jobNo: string; author: string; orderedAt: string; expectedAt: string;
  recipient: string; phone: string; address: string;
  garmentType: string; fabricName: string; fabricWeight: string; typeName: string;
  colors: Color[]; nameOf: (t: any) => string;
  qtyByColor: Record<string, Record<Size, number>>;
  colorTotals: Record<string, number>;
  sizeTotals: Record<Size, number>;
  total: number; notes: string;
}) {
  return (
    <div className="bg-white text-black p-6 rounded border print:border-0">
      <h2 className="text-2xl font-bold text-center mb-4">발 주 서 (PURCHASE ORDER)</h2>
      <table className="w-full text-sm border-collapse mb-4">
        <tbody>
          <tr><th className="border p-2 bg-gray-100 w-32 text-left">발주업체명</th><td className="border p-2">{company}</td>
              <th className="border p-2 bg-gray-100 w-32 text-left">작업번호</th><td className="border p-2">{jobNo || "-"}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">발주일</th><td className="border p-2">{orderedAt}</td>
              <th className="border p-2 bg-gray-100 text-left">납품일</th><td className="border p-2">{expectedAt || "-"}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">받을사람</th><td className="border p-2">{recipient}</td>
              <th className="border p-2 bg-gray-100 text-left">전화번호</th><td className="border p-2">{phone}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">주소</th><td className="border p-2" colSpan={3}>{address}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">의류 종류</th><td className="border p-2">{garmentType || "-"}</td>
              <th className="border p-2 bg-gray-100 text-left">티셔츠 종류</th><td className="border p-2">{typeName || "-"}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">원단 이름</th><td className="border p-2">{fabricName || "-"}</td>
              <th className="border p-2 bg-gray-100 text-left">원단 중량</th><td className="border p-2">{fabricWeight || "-"}</td></tr>
          <tr><th className="border p-2 bg-gray-100 text-left">작성자</th><td className="border p-2">{author}</td>
              <th className="border p-2 bg-gray-100 text-left">총수량</th><td className="border p-2 font-bold">{total}</td></tr>
        </tbody>
      </table>

      <h3 className="font-semibold mb-2">색상별 수량</h3>
      <table className="w-full text-sm border-collapse mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">색상</th>
            {SIZES.map(s => <th key={s} className="border p-2">{s}</th>)}
            <th className="border p-2">합계</th>
          </tr>
        </thead>
        <tbody>
          {colors.map(c => (
            <tr key={c.code}>
              <td className="border p-2">{nameOf(c)}</td>
              {SIZES.map(s => <td key={s} className="border p-2 text-center">{qtyByColor[c.code]?.[s] || 0}</td>)}
              <td className="border p-2 text-center font-semibold">{colorTotals[c.code] || 0}</td>
            </tr>
          ))}
          <tr className="bg-gray-50">
            <td className="border p-2 font-semibold text-right">사이즈 합계</td>
            {SIZES.map(s => <td key={s} className="border p-2 text-center font-semibold">{sizeTotals[s] || 0}</td>)}
            <td className="border p-2 text-center font-bold">{total}</td>
          </tr>
        </tbody>
      </table>

      {notes && (
        <>
          <h3 className="font-semibold mb-2">발주 특이사항</h3>
          <div className="border p-3 whitespace-pre-wrap text-sm min-h-[60px]">{notes}</div>
        </>
      )}
    </div>
  );
}

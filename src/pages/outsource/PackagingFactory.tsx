import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  Package, AlertTriangle, CheckCircle2, CircleSlash, Mail, ShoppingCart, CreditCard, Shirt, Truck, Building2,
} from "lucide-react";

/**
 * 부자재(포장용품) 공장
 * - 비닐포장(카드포장지/티셔츠포장지) — 업체 A
 * - 택배봉투 — 업체 B
 * 페이지 구조: [재고현황 & 발주목록] / [발주지시]
 */

type Vendor = "vinyl" | "mailer";
type VinylKind = "card" | "tshirt";

type InventoryRow = {
  id: string;
  vendor: Vendor;
  kind?: VinylKind;
  label: string;
  unit: string;
  in_stock: number;
  safety_stock: number;
};

type PO = {
  id: string;
  po_number: string;
  ordered_at: string;
  expected_at: string | null;
  vendor: Vendor;
  kind?: VinylKind;
  quantity: number;
  unit: string;
  status: "ordered" | "in_production" | "shipped" | "received";
  notes?: string;
};

const INITIAL_INVENTORY: InventoryRow[] = [
  { id: "v-card", vendor: "vinyl", kind: "card", label: "비닐포장지 - 카드용", unit: "kg", in_stock: 80, safety_stock: 100 },
  { id: "v-tshirt", vendor: "vinyl", kind: "tshirt", label: "비닐포장지 - 티셔츠용", unit: "장", in_stock: 12000, safety_stock: 10000 },
  { id: "m-std", vendor: "mailer", label: "택배봉투 (표준)", unit: "장", in_stock: 4500, safety_stock: 5000 },
];

const VENDOR_NAME: Record<Vendor, string> = {
  vinyl: "비닐포장 공장 (업체 A)",
  mailer: "택배봉투 공장 (업체 B)",
};

function statusInfo(stock: number, safety: number) {
  if (stock <= 0) return { key: "out", color: "bg-zinc-500", text: "text-zinc-400", label: "품절" };
  const r = safety > 0 ? stock / safety : 1;
  if (r < 0.5) return { key: "critical", color: "bg-red-500", text: "text-red-500", label: "품절 임박" };
  if (r < 1) return { key: "low", color: "bg-yellow-500", text: "text-yellow-500", label: "재고 부족" };
  return { key: "ok", color: "bg-emerald-500", text: "text-emerald-500", label: "정상" };
}

function poStatusLabel(s: PO["status"]) {
  return ({ ordered: "발주 완료", in_production: "생산 중", shipped: "발송 완료", received: "입고 완료" } as const)[s];
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function PackagingFactory() {
  const [tab, setTab] = useState("inventory");
  const [inventory, setInventory] = useState<InventoryRow[]>(INITIAL_INVENTORY);
  const [pos, setPos] = useState<PO[]>([]);

  // PO form state
  const [vendor, setVendor] = useState<Vendor>("vinyl");
  const [vinylKind, setVinylKind] = useState<VinylKind>("card");
  const [qty, setQty] = useState<number>(100);
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const unitOf = (v: Vendor, k?: VinylKind) => {
    if (v === "mailer") return "장";
    return k === "card" ? "kg" : "장";
  };
  const minQtyOf = (v: Vendor, k?: VinylKind) => {
    if (v === "vinyl" && k === "card") return 100;     // 100kg
    if (v === "vinyl" && k === "tshirt") return 10000; // 10000장
    return 1;
  };

  // Adjust qty when vendor/kind changes
  const onVendorChange = (v: Vendor) => {
    setVendor(v);
    setQty(minQtyOf(v, v === "vinyl" ? vinylKind : undefined));
  };
  const onKindChange = (k: VinylKind) => {
    setVinylKind(k);
    setQty(minQtyOf("vinyl", k));
  };

  const kpi = useMemo(() => {
    let ok = 0, low = 0, critical = 0, out = 0;
    for (const i of inventory) {
      const k = statusInfo(i.in_stock, i.safety_stock).key;
      if (k === "ok") ok++; else if (k === "low") low++; else if (k === "critical") critical++; else out++;
    }
    return { ok, low, critical, out };
  }, [inventory]);

  const vinylRows = inventory.filter(i => i.vendor === "vinyl");
  const mailerRows = inventory.filter(i => i.vendor === "mailer");

  const goPurchase = (row: InventoryRow) => {
    setVendor(row.vendor);
    if (row.vendor === "vinyl" && row.kind) {
      setVinylKind(row.kind);
      setQty(minQtyOf("vinyl", row.kind));
    } else {
      setQty(minQtyOf(row.vendor));
    }
    setTab("create");
  };

  const updateSafety = (id: string, val: number) => {
    setInventory(prev => prev.map(r => r.id === id ? { ...r, safety_stock: val } : r));
  };

  const submitPo = () => {
    const min = minQtyOf(vendor, vendor === "vinyl" ? vinylKind : undefined);
    const unit = unitOf(vendor, vendor === "vinyl" ? vinylKind : undefined);
    if (!qty || qty < min) {
      toast({
        title: "최소 주문 수량 미달",
        description: `${vendor === "vinyl" ? (vinylKind === "card" ? "카드포장지" : "티셔츠포장지") : "택배봉투"} 최소 주문은 ${min}${unit} 입니다.`,
        variant: "destructive",
      });
      return;
    }
    const id = crypto.randomUUID();
    const po: PO = {
      id,
      po_number: `PKG-${new Date().getFullYear()}-${String(pos.length + 1).padStart(4, "0")}`,
      ordered_at: todayStr(),
      expected_at: expectedAt || null,
      vendor,
      kind: vendor === "vinyl" ? vinylKind : undefined,
      quantity: qty,
      unit,
      status: "ordered",
      notes,
    };
    setPos(prev => [po, ...prev]);
    toast({ title: "발주 등록됨", description: `${po.po_number} · ${qty}${unit}` });
    setNotes("");
    setExpectedAt("");
    setTab("inventory");
  };

  const changePoStatus = (id: string, next: PO["status"]) => {
    setPos(prev => prev.map(p => {
      if (p.id !== id) return p;
      // If received, add to inventory
      if (next === "received" && p.status !== "received") {
        setInventory(inv => inv.map(r => {
          const match = r.vendor === p.vendor && (p.vendor !== "vinyl" || r.kind === p.kind);
          return match ? { ...r, in_stock: r.in_stock + p.quantity } : r;
        }));
      }
      return { ...p, status: next };
    }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6" /> 부자재(포장용품) 공장
          </h1>
          <p className="text-sm text-muted-foreground">비닐포장 · 택배봉투 재고 현황 및 발주 관리</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inventory">재고 현황 & 발주 목록</TabsTrigger>
          <TabsTrigger value="create">발주 지시</TabsTrigger>
        </TabsList>

        {/* ============ 재고현황 & 발주목록 ============ */}
        <TabsContent value="inventory" className="space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiTile icon={<CheckCircle2 className="w-5 h-5" />} label="정상" value={kpi.ok} color="text-emerald-500" dot="bg-emerald-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="재고 부족" value={kpi.low} color="text-yellow-500" dot="bg-yellow-500" />
            <KpiTile icon={<AlertTriangle className="w-5 h-5" />} label="품절 임박" value={kpi.critical} color="text-red-500" dot="bg-red-500" />
            <KpiTile icon={<CircleSlash className="w-5 h-5" />} label="품절" value={kpi.out} color="text-zinc-400" dot="bg-zinc-500" />
          </div>

          {/* 비닐포장 공장 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4" /> {VENDOR_NAME.vinyl}
                <Badge variant="outline" className="ml-2">비닐포장</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InventoryTable
                rows={vinylRows}
                renderKind={(r) => r.kind === "card"
                  ? <span className="inline-flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> 카드포장지</span>
                  : <span className="inline-flex items-center gap-1"><Shirt className="w-3.5 h-3.5" /> 티셔츠포장지</span>}
                onSafetyChange={updateSafety}
                onPurchase={goPurchase}
              />
            </CardContent>
          </Card>

          {/* 택배봉투 공장 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="w-4 h-4" /> {VENDOR_NAME.mailer}
                <Badge variant="outline" className="ml-2">택배봉투</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InventoryTable
                rows={mailerRows}
                renderKind={() => <span className="inline-flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> 택배봉투</span>}
                onSafetyChange={updateSafety}
                onPurchase={goPurchase}
              />
            </CardContent>
          </Card>

          {/* 발주 목록 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">발주 목록</CardTitle>
            </CardHeader>
            <CardContent>
              {pos.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">등록된 발주가 없습니다.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>발주번호</TableHead>
                      <TableHead>발주일</TableHead>
                      <TableHead>예상 입고일</TableHead>
                      <TableHead>공장</TableHead>
                      <TableHead>품목</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                      <TableHead>상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pos.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.po_number}</TableCell>
                        <TableCell>{p.ordered_at}</TableCell>
                        <TableCell>{p.expected_at ?? "-"}</TableCell>
                        <TableCell>{VENDOR_NAME[p.vendor]}</TableCell>
                        <TableCell>
                          {p.vendor === "vinyl"
                            ? (p.kind === "card" ? "카드포장지" : "티셔츠포장지")
                            : "택배봉투"}
                        </TableCell>
                        <TableCell className="text-right">{p.quantity.toLocaleString()} {p.unit}</TableCell>
                        <TableCell>
                          <Select value={p.status} onValueChange={(v) => changePoStatus(p.id, v as PO["status"])}>
                            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ordered">{poStatusLabel("ordered")}</SelectItem>
                              <SelectItem value="in_production">{poStatusLabel("in_production")}</SelectItem>
                              <SelectItem value="shipped">{poStatusLabel("shipped")}</SelectItem>
                              <SelectItem value="received">{poStatusLabel("received")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============ 발주 지시 ============ */}
        <TabsContent value="create" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">발주 공장 선택</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <VendorPickCard
                  active={vendor === "vinyl"}
                  onClick={() => onVendorChange("vinyl")}
                  icon={<Package className="w-5 h-5" />}
                  title="비닐포장 발주"
                  desc="카드포장지 / 티셔츠포장지 (업체 A)"
                />
                <VendorPickCard
                  active={vendor === "mailer"}
                  onClick={() => onVendorChange("mailer")}
                  icon={<Mail className="w-5 h-5" />}
                  title="택배봉투 발주"
                  desc="택배 발송용 봉투 (업체 B)"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {vendor === "vinyl" ? "비닐포장 발주서" : "택배봉투 발주서"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {vendor === "vinyl" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <KindPickCard
                    active={vinylKind === "card"}
                    onClick={() => onKindChange("card")}
                    icon={<CreditCard className="w-5 h-5" />}
                    title="카드포장지"
                    desc="최소 주문 100 kg"
                  />
                  <KindPickCard
                    active={vinylKind === "tshirt"}
                    onClick={() => onKindChange("tshirt")}
                    icon={<Shirt className="w-5 h-5" />}
                    title="티셔츠포장지"
                    desc="최소 주문 10,000 장"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">수량</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={minQtyOf(vendor, vendor === "vinyl" ? vinylKind : undefined)}
                      value={qty}
                      onChange={(e) => setQty(Number(e.target.value) || 0)}
                    />
                    <span className="text-sm text-muted-foreground w-10">
                      {unitOf(vendor, vendor === "vinyl" ? vinylKind : undefined)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    최소: {minQtyOf(vendor, vendor === "vinyl" ? vinylKind : undefined).toLocaleString()} {unitOf(vendor, vendor === "vinyl" ? vinylKind : undefined)}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">예상 입고일</label>
                  <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">발주일</label>
                  <Input type="date" value={todayStr()} disabled />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">비고</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="요청사항을 입력해주세요"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setTab("inventory")}>취소</Button>
                <Button onClick={submitPo}>
                  <ShoppingCart className="w-4 h-4 mr-1" /> 발주 등록
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiTile({ icon, label, value, color, dot }: { icon: React.ReactNode; label: string; value: number; color: string; dot: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        <div className={color}>{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function InventoryTable({
  rows, renderKind, onSafetyChange, onPurchase,
}: {
  rows: InventoryRow[];
  renderKind: (r: InventoryRow) => React.ReactNode;
  onSafetyChange: (id: string, val: number) => void;
  onPurchase: (r: InventoryRow) => void;
}) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground py-4 text-center">항목이 없습니다.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>품목</TableHead>
          <TableHead className="text-right">현재 재고</TableHead>
          <TableHead className="w-40">안전 재고</TableHead>
          <TableHead>상태</TableHead>
          <TableHead className="text-right">작업</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(r => {
          const s = statusInfo(r.in_stock, r.safety_stock);
          return (
            <TableRow key={r.id}>
              <TableCell>
                <div className="font-medium">{renderKind(r)}</div>
                <div className="text-xs text-muted-foreground">{r.label}</div>
              </TableCell>
              <TableCell className="text-right font-mono">
                {r.in_stock.toLocaleString()} <span className="text-xs text-muted-foreground">{r.unit}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={r.safety_stock}
                    onChange={(e) => onSafetyChange(r.id, Number(e.target.value) || 0)}
                    className="h-8"
                  />
                  <span className="text-xs text-muted-foreground">{r.unit}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
                  <span className={`text-sm ${s.text}`}>{s.label}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" onClick={() => onPurchase(r)}>
                  <ShoppingCart className="w-3.5 h-3.5 mr-1" /> 발주하기
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function VendorPickCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-lg border transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
    >
      <div className="flex items-center gap-3">
        <div className={active ? "text-primary" : "text-muted-foreground"}>{icon}</div>
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
    </button>
  );
}

function KindPickCard({ active, onClick, icon, title, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-md border transition-colors ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
    >
      <div className="flex items-center gap-2">
        <div className={active ? "text-primary" : "text-muted-foreground"}>{icon}</div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
    </button>
  );
}

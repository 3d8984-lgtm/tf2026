import { useLang } from "@/contexts/LangContext";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Save, X, Search, ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface InspectionStandard {
  id: number;
  process: string;
  item: string;
  method: string;
  criteria: string;
  autoStop: boolean;
  enabled: boolean;
  minVal?: number;
  maxVal?: number;
  unit?: string;
}

/* ── 공통 검수 기준 mock ── */
const defaultStandards: InspectionStandard[] = [
  { id: 1, process: "setpacking", item: "QR 매칭", method: "QR + 바코드 스캔", criteria: "홀로그램 QR값 ↔ 카드 바코드값 일치", autoStop: true, enabled: true },
  { id: 2, process: "setpacking", item: "중량 검사", method: "중량 센서", criteria: "270g ~ 300g", minVal: 270, maxVal: 300, unit: "g", autoStop: true, enabled: true },
  { id: 3, process: "shipping", item: "송장 매칭", method: "바코드 스캔", criteria: "세트 QR ↔ 송장 바코드 주문정보 일치", autoStop: true, enabled: true },
];

/* ── 주문별 예외 기준 mock ── */
const defaultOrderOverrides = [
  { id: 1, orderId: "ORD-2024-0042", orderName: "VIP 특별 주문", process: "setpacking", item: "중량 검사", criteria: "250g ~ 320g", minVal: 250, maxVal: 320, unit: "g", reason: "특수 포장재 사용" },
  { id: 2, orderId: "ORD-2024-0088", orderName: "대량 프로모션", process: "shipping", item: "택배 중량", criteria: "280g ~ 550g", minVal: 280, maxVal: 550, unit: "g", reason: "추가 홍보물 동봉" },
];

const defaultStandardsZh = defaultStandards.map(s => ({
  ...s,
  item: ({ "QR 매칭": "QR匹配", "중량 검사": "重量检查", "송장 매칭": "运单匹配", "택배 중량": "快递重量", "QR 부착 확인": "QR贴附确认", "카드 중량": "卡片重量" } as Record<string, string>)[s.item] ?? s.item,
  method: ({ "QR 이중 스캔": "QR双重扫描", "중량 센서": "重量传感器", "바코드 스캔": "条码扫描", "QR 재스캔": "QR重新扫描" } as Record<string, string>)[s.method] ?? s.method,
  criteria: s.criteria
    .replace("티셔츠 QR ↔ 카드 QR 디자인코드 일치", "T恤QR ↔ 卡片QR设计码匹配")
    .replace("세트 QR ↔ 송장 바코드 주문정보 일치", "套装QR ↔ 运单条码订单信息匹配")
    .replace("홀로그램 QR 정상 스캔", "全息QR正常扫描"),
}));

const defaultOrderOverridesZh = defaultOrderOverrides.map(o => ({
  ...o,
  orderName: ({ "VIP 특별 주문": "VIP特别订单", "대량 프로모션": "大量促销" } as Record<string, string>)[o.orderName] ?? o.orderName,
  item: ({ "중량 검사": "重量检查", "택배 중량": "快递重量" } as Record<string, string>)[o.item] ?? o.item,
  reason: ({ "특수 포장재 사용": "使用特殊包装材料", "추가 홍보물 동봉": "附加宣传资料" } as Record<string, string>)[o.reason] ?? o.reason,
}));

const processLabels: Record<string, Record<string, string>> = {
  ko: { tshirt: "티셔츠 부착", card: "카드 포장", setpacking: "세트 포장", shipping: "택배 출고" },
  zh: { tshirt: "T恤贴附", card: "卡片包装", setpacking: "套装包装", shipping: "快递出库" },
};

export default function InspectionStandards() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const [standards, setStandards] = useState(isKo ? defaultStandards : defaultStandardsZh);
  const [overrides] = useState(isKo ? defaultOrderOverrides : defaultOrderOverridesZh);
  const [subTab, setSubTab] = useState("common");
  const [processFilter, setProcessFilter] = useState("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMin, setEditMin] = useState("");
  const [editMax, setEditMax] = useState("");
  const [searchOrder, setSearchOrder] = useState("");

  const filteredStandards = standards.filter(s => processFilter === "all" || s.process === processFilter);
  const filteredOverrides = overrides.filter(o =>
    searchOrder === "" || o.orderId.toLowerCase().includes(searchOrder.toLowerCase()) || o.orderName.toLowerCase().includes(searchOrder.toLowerCase())
  );

  const startEdit = (s: typeof standards[0]) => {
    setEditingId(s.id);
    setEditMin(s.minVal?.toString() ?? "");
    setEditMax(s.maxVal?.toString() ?? "");
  };

  const saveEdit = (id: number) => {
    setStandards(prev => prev.map(s => {
      if (s.id !== id) return s;
      const min = parseFloat(editMin);
      const max = parseFloat(editMax);
      if (isNaN(min) || isNaN(max)) return s;
      return { ...s, minVal: min, maxVal: max, criteria: `${min}${s.unit} ~ ${max}${s.unit}` };
    }));
    setEditingId(null);
  };

  const toggleEnabled = (id: number) => {
    setStandards(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  const toggleAutoStop = (id: number) => {
    setStandards(prev => prev.map(s => s.id === id ? { ...s, autoStop: !s.autoStop } : s));
  };

  const pLabels = processLabels[lang] ?? processLabels.ko;

  return (
    <div className="section-enter">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {t("settings.inspection")}
          </h3>
          <TabsList className="h-8">
            <TabsTrigger value="common" className="text-xs px-3 py-1">{t("settings.insp.common")}</TabsTrigger>
            <TabsTrigger value="order" className="text-xs px-3 py-1">{t("settings.insp.orderOverride")}</TabsTrigger>
          </TabsList>
        </div>

        {/* 공통 검수 기준 */}
        <TabsContent value="common">
          <div className="flex items-center gap-2 mb-4">
            <Select value={processFilter} onValueChange={setProcessFilter}>
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("settings.insp.allProcess")}</SelectItem>
                <SelectItem value="tshirt">{pLabels.tshirt}</SelectItem>
                <SelectItem value="card">{pLabels.card}</SelectItem>
                <SelectItem value="setpacking">{pLabels.setpacking}</SelectItem>
                <SelectItem value="shipping">{pLabels.shipping}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="gap-1.5 ml-auto"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.insp.process")}</TableHead>
                  <TableHead>{t("settings.insp.item")}</TableHead>
                  <TableHead>{t("settings.insp.method")}</TableHead>
                  <TableHead>{t("settings.insp.criteria")}</TableHead>
                  <TableHead className="text-center">{t("settings.insp.autoStop")}</TableHead>
                  <TableHead className="text-center">{t("settings.insp.enabled")}</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStandards.map(s => (
                  <TableRow key={s.id} className={!s.enabled ? "opacity-50" : ""}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{pLabels[s.process]}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{s.item}</TableCell>
                    <TableCell className="text-sm">{s.method}</TableCell>
                    <TableCell>
                      {editingId === s.id && s.minVal !== undefined ? (
                        <div className="flex items-center gap-1">
                          <Input className="w-16 h-7 text-xs" value={editMin} onChange={e => setEditMin(e.target.value)} />
                          <span className="text-xs">~</span>
                          <Input className="w-16 h-7 text-xs" value={editMax} onChange={e => setEditMax(e.target.value)} />
                          <span className="text-xs text-muted-foreground">{s.unit}</span>
                        </div>
                      ) : (
                        <Badge variant="secondary" className="text-xs font-mono">{s.criteria}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={s.autoStop} onCheckedChange={() => toggleAutoStop(s.id)} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={s.enabled} onCheckedChange={() => toggleEnabled(s.id)} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {editingId === s.id ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => saveEdit(s.id)}><Save className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5" /></Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(s)} disabled={!s.minVal}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
            💡 {t("settings.insp.commonHint")}
          </div>
        </TabsContent>

        {/* 주문별 예외 기준 */}
        <TabsContent value="order">
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder={t("settings.insp.searchOrder")}
                value={searchOrder}
                onChange={e => setSearchOrder(e.target.value)}
              />
            </div>
            <Button size="sm" className="gap-1.5 ml-auto"><Plus className="w-4 h-4" />{t("settings.insp.addOverride")}</Button>
          </div>

          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.insp.orderId")}</TableHead>
                  <TableHead>{t("settings.insp.orderName")}</TableHead>
                  <TableHead>{t("settings.insp.process")}</TableHead>
                  <TableHead>{t("settings.insp.item")}</TableHead>
                  <TableHead>{t("settings.insp.criteria")}</TableHead>
                  <TableHead>{t("settings.insp.reason")}</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOverrides.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {t("settings.insp.noOverrides")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOverrides.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs font-medium">{o.orderId}</TableCell>
                      <TableCell className="font-medium">{o.orderName}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{pLabels[o.process]}</Badge></TableCell>
                      <TableCell>{o.item}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs font-mono bg-amber-50 text-amber-700 border-amber-200">
                          {o.criteria}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.reason}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
            💡 {t("settings.insp.orderHint")}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

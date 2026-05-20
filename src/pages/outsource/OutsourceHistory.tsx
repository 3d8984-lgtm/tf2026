import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useLang } from "@/contexts/LangContext";
import { CheckCircle2, Clock, Search, Truck } from "lucide-react";
import { toast } from "@/hooks/use-toast";

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

const SAMPLE: HistoryRow[] = [
  { id: "H001", factory: "silicon", orderNo: "TM-2026-0001", orderedAt: "2026-05-12", qty: 220, productCode: "TS-RED-100", startedAt: "2026-05-12", expectedAt: "2026-05-14", producedAt: "2026-05-14", shippedAt: "2026-05-14", trackingNo: "SF1234567890", carrier: "SF Express", receivedAt: "2026-05-17", status: "received" },
  { id: "H002", factory: "heat", orderNo: "TM-2026-0001", orderedAt: "2026-05-12", qty: 220, productCode: "TS-RED-100", startedAt: "2026-05-12", expectedAt: "2026-05-15", producedAt: "2026-05-15", shippedAt: "2026-05-15", trackingNo: "YT9988776655", carrier: "YTO", status: "shipped" },
  { id: "H003", factory: "hologram", orderNo: "TM-2026-0002", orderedAt: "2026-05-13", qty: 330, productCode: "TS-BLU-200", startedAt: "2026-05-13", expectedAt: "2026-05-16", status: "ordered" },
  { id: "H004", factory: "nfc", orderNo: "TM-2026-0002", orderedAt: "2026-05-13", qty: 330, productCode: "TS-BLU-200", startedAt: "2026-05-13", expectedAt: "2026-05-16", producedAt: "2026-05-16", shippedAt: "2026-05-16", trackingNo: "ZTO11223344", carrier: "ZTO", status: "shipped" },
  { id: "H005", factory: "logo", orderNo: "TM-2026-0003", orderedAt: "2026-05-14", qty: 165, productCode: "LOGO-A", startedAt: "2026-05-14", expectedAt: "2026-05-15", producedAt: "2026-05-15", shippedAt: "2026-05-15", trackingNo: "JD556677889", carrier: "JD", receivedAt: "2026-05-18", status: "received" },
  { id: "H006", factory: "silicon", orderNo: "TM-2026-0004", orderedAt: "2026-05-15", qty: 110, productCode: "TS-BLK-300", startedAt: "2026-05-15", expectedAt: "2026-05-18", status: "ordered" },
  { id: "H007", factory: "logo", orderNo: "TM-2026-0004", orderedAt: "2026-05-15", qty: 110, productCode: "LOGO-B", startedAt: "2026-05-15", expectedAt: "2026-05-16", producedAt: "2026-05-16", shippedAt: "2026-05-16", trackingNo: "EMS998877665", carrier: "EMS", status: "shipped" },
];

export default function OutsourceHistory() {
  const { lang } = useLang();
  const [rows, setRows] = useState<HistoryRow[]>(SAMPLE);
  const [factoryFilter, setFactoryFilter] = useState<Factory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [q, setQ] = useState("");

  const factoryLabel = lang === "ko" ? FACTORY_LABEL_KO : FACTORY_LABEL_ZH;

  const filtered = useMemo(() => rows.filter(r =>
    (factoryFilter === "all" || r.factory === factoryFilter) &&
    (statusFilter === "all" || r.status === statusFilter) &&
    (!q || r.orderNo.toLowerCase().includes(q.toLowerCase()) || (r.trackingNo ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, factoryFilter, statusFilter, q]);

  const stats = useMemo(() => ({
    total: rows.length,
    ordered: rows.filter(r => r.status === "ordered").length,
    shipped: rows.filter(r => r.status === "shipped").length,
    received: rows.filter(r => r.status === "received").length,
  }), [rows]);

  const confirmReceived = (id: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: "received", receivedAt: new Date().toISOString().slice(0, 10) } : r));
    toast({ title: lang === "ko" ? "수령 확인 완료" : "已确认收货" });
  };

  const statusBadge = (s: Status) => {
    const map: Record<Status, { label: string; cls: string; icon: typeof Clock }> = {
      ordered: { label: lang === "ko" ? "발주" : "已发单", cls: "bg-muted text-muted-foreground", icon: Clock },
      shipped: { label: lang === "ko" ? "발송" : "已发货", cls: "bg-primary/15 text-primary", icon: Truck },
      received: { label: lang === "ko" ? "수령 완료" : "已收货", cls: "bg-success/15 text-success", icon: CheckCircle2 },
    };
    const it = map[s];
    const Icon = it.icon;
    return (
      <Badge variant="outline" className={`gap-1 ${it.cls}`}>
        <Icon className="w-3 h-3" />{it.label}
      </Badge>
    );
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
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as Status | "all")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{lang === "ko" ? "전체 상태" : "全部状态"}</SelectItem>
              <SelectItem value="ordered">{lang === "ko" ? "발주" : "已发单"}</SelectItem>
              <SelectItem value="shipped">{lang === "ko" ? "발송" : "已发货"}</SelectItem>
              <SelectItem value="received">{lang === "ko" ? "수령 완료" : "已收货"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{lang === "ko" ? "공장" : "工厂"}</TableHead>
                <TableHead>{lang === "ko" ? "작업번호" : "订单号"}</TableHead>
                <TableHead>{lang === "ko" ? "기본정보" : "基本信息"}</TableHead>
                <TableHead className="text-right">{lang === "ko" ? "수량" : "数量"}</TableHead>
                <TableHead>{lang === "ko" ? "발주일" : "发单日期"}</TableHead>
                <TableHead>{lang === "ko" ? "발송일" : "发货日期"}</TableHead>
                <TableHead>{lang === "ko" ? "송장번호" : "运单号"}</TableHead>
                <TableHead>{lang === "ko" ? "수령일" : "收货日期"}</TableHead>
                <TableHead>{lang === "ko" ? "상태" : "状态"}</TableHead>
                <TableHead className="text-right">{lang === "ko" ? "동작" : "操作"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant="secondary">{factoryLabel[r.factory]}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{r.orderNo}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.productCode}</TableCell>
                  <TableCell className="text-right">{r.qty.toLocaleString()}</TableCell>
                  <TableCell>{r.orderedAt}</TableCell>
                  <TableCell>{r.shippedAt ?? "-"}</TableCell>
                  <TableCell>
                    {r.trackingNo ? (
                      <div className="text-xs">
                        <p className="font-mono">{r.trackingNo}</p>
                        <p className="text-muted-foreground">{r.carrier}</p>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{r.receivedAt ?? "-"}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "shipped" && (
                      <Button size="sm" variant="outline" onClick={() => confirmReceived(r.id)}>
                        {lang === "ko" ? "수령 확인" : "确认收货"}
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

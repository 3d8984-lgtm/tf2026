import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScanLine, Search, Truck, Package, CheckCircle2, Send } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useShippingQueue, useShippingQueueKpis, type ScanStatus } from "@/hooks/useShippingQueue";
import { format } from "date-fns";

const STATUSES: { value: ScanStatus | "all"; ko: string; zh: string }[] = [
  { value: "all", ko: "전체", zh: "全部" },
  { value: "pending", ko: "대기", zh: "待处理" },
  { value: "scanning", ko: "스캔중", zh: "扫描中" },
  { value: "ready", ko: "송장발급", zh: "已出运单" },
  { value: "shipped", ko: "발송완료", zh: "已发货" },
  { value: "reported", ko: "회신완료", zh: "已回报" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  scanning: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  ready: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  shipped: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  reported: "bg-violet-500/15 text-violet-400 border-violet-500/30",
};

export default function Shipping() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ScanStatus | "all">("all");

  const { data: kpis } = useShippingQueueKpis();
  const { data: rows = [], isLoading } = useShippingQueue({ status, search });

  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const statusLabel = (s: string) => {
    const item = STATUSES.find((x) => x.value === s);
    return item ? (isKo ? item.ko : item.zh) : s;
  };

  return (
    <div className="space-y-6">
      <PageHeader title={tr("배송 관리", "配送管理")} description={tr("QR 스캔 → 디자인 검수 → 송장 발급 → 트윈메타 회신", "扫码 → 检验 → 出运单 → 回报")} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([
          { k: "pending", icon: Package, color: "text-muted-foreground", label: tr("대기", "待处理") },
          { k: "scanning", icon: ScanLine, color: "text-blue-400", label: tr("스캔중", "扫描中") },
          { k: "ready", icon: Truck, color: "text-amber-400", label: tr("송장발급", "已出运单") },
          { k: "shipped", icon: CheckCircle2, color: "text-emerald-400", label: tr("발송완료", "已发货") },
          { k: "reported", icon: Send, color: "text-violet-400", label: tr("회신완료", "已回报") },
        ] as const).map(({ k, icon: Icon, color, label }) => (
          <Card key={k}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-5 h-5 ${color}`} />
              <div>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold">{(kpis as any)?.[k] ?? 0}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={tr("Job No, Twinker, 송장번호 검색", "搜索 Job No / Twinker / 运单号")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="md:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{isKo ? s.ko : s.zh}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job No</TableHead>
                <TableHead>{tr("Twinker", "Twinker")}</TableHead>
                <TableHead>{tr("도시/지역", "城市/州")}</TableHead>
                <TableHead className="text-center">{tr("진행", "进度")}</TableHead>
                <TableHead>{tr("상태", "状态")}</TableHead>
                <TableHead>{tr("송장번호", "运单号")}</TableHead>
                <TableHead>{tr("납기일", "交期")}</TableHead>
                <TableHead className="text-right">{tr("작업", "操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">{tr("불러오는 중...", "加载中...")}</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">{tr("표시할 주문이 없습니다", "暂无订单")}</TableCell></TableRow>
              ) : (
                rows.map((r: any) => {
                  const total = r.orders?.quantity ?? 0;
                  const scanned = r.scanned_count ?? 0;
                  const pct = total ? Math.round((scanned / total) * 100) : 0;
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-accent/30" onClick={() => navigate(`/shipping/scan/${r.order_id}`)}>
                      <TableCell className="font-mono text-sm text-primary hover:underline">{r.orders?.external_order_id}</TableCell>
                      <TableCell>{r.orders?.recipient_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[r.orders?.shipping_city, r.orders?.shipping_state].filter(Boolean).join(", ")}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center gap-2 justify-center">
                          <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs font-mono tabular-nums">{scanned}/{total}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[r.scan_status] ?? ""}>{statusLabel(r.scan_status)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.tracking_number ?? "-"}</TableCell>
                      <TableCell className="text-sm">{r.orders?.project_completed_at ? format(new Date(r.orders.project_completed_at), "yyyy-MM-dd") : "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/shipping/scan/${r.order_id}`); }}>
                          <ScanLine className="w-4 h-4 mr-1" />
                          {r.scan_status === "reported" ? tr("보기", "查看") : tr("스캔 시작", "开始扫码")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

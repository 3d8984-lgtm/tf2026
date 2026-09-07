import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/contexts/LangContext";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2, Printer } from "lucide-react";
import {
  SetInspectDetail, loadStore, saveStore,
  type OrderRow, type PairResult, type Store,
} from "@/pages/SetQrInspection";
import { buildExpected } from "@/components/BarcodePrintWorkspace";
import QrLabelPrintPanel from "@/components/qr-label/QrLabelPrintPanel";

export default function TshirtSetPacking() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const [store, setStore] = useState<Store>(() => loadStore());

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, external_order_id, product_code, design_code, quantity, recipient_name, project_completed_at, created_at, source_data")
        .order("created_at", { ascending: false })
        .limit(200);
      setOrders((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  const update = useCallback((orderId: string, next: Record<number, PairResult>) => {
    setStore((prev) => {
      const merged = { ...prev, [orderId]: next };
      saveStore(merged);
      return merged;
    });
  }, []);

  if (selected) {
    return (
      <CombinedDetail
        order={selected}
        results={store[selected.id] ?? {}}
        onChange={(next) => update(selected.id, next)}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={tr("티셔츠세트 포장", "T恤套装包装")}
        description={tr("주문을 선택한 후 세트 QR 검사와 티셔츠 QR 라벨 인쇄를 진행합니다", "选择订单后进行套装QR检验与T恤QR标签打印")}
      />
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : orders.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">{tr("주문 데이터가 없습니다", "暂无订单数据")}</p>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{tr("작업지시번호", "工单号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("트윈커", "Twinker")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("상품", "商品")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("수량", "数量")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("검사 진행", "检验进度")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("납기일", "交期")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const res = store[o.id] ?? {};
                  const values = Object.values(res);
                  const pass = values.filter((r) => r.ok).length;
                  const fail = values.filter((r) => !r.ok).length;
                  const total = Math.max(Array.isArray(o.source_data?.items) ? o.source_data.items.length : 0, o.quantity ?? 0);
                  const pct = total > 0 ? Math.round((values.length / total) * 100) : 0;
                  return (
                    <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setSelected(o)}>
                      <td className="px-4 py-3 font-mono font-medium text-primary hover:underline">{o.external_order_id}</td>
                      <td className="px-4 py-3">{o.recipient_name}</td>
                      <td className="px-4 py-3">{o.product_code}</td>
                      <td className="px-4 py-3 tabular-nums">{total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{values.length}/{total}</span>
                          {pass > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">✓{pass}</span>}
                          {fail > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">!{fail}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {o.project_completed_at ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline">{tr("선택", "选择")}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CombinedDetail({
  order, results, onChange, onBack,
}: {
  order: OrderRow;
  results: Record<number, PairResult>;
  onChange: (next: Record<number, PairResult>) => void;
  onBack: () => void;
}) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  // 티셔츠 스티커 고유번호(-3) 기대 목록 → QR 라벨 인쇄 패널 데이터
  const labelItems = useMemo(() => {
    const expected = buildExpected(order, "-3");
    return expected.map((e) => {
      const it: any = (order.source_data as any)?.items?.[e.position - 1] ?? {};
      return {
        position: e.position,
        code: e.no,
        editionRaw: it.edition ?? it.edition_number ?? it.editionNumber,
      };
    });
  }, [order]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={`${tr("티셔츠세트 포장", "T恤套装包装")} · ${order.external_order_id}`}
        description={`${order.recipient_name} · ${tr("상품", "商品")} ${order.product_code} · ${tr("수량", "数量")} ${order.quantity}`}
      >
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" /> {tr("주문 목록", "订单列表")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8">
        {/* 상단: 세트 큐알코드 검사 */}
        <SetInspectDetail embedded order={order} results={results} onChange={onChange} onBack={onBack} />

        {/* 하단: QR 라벨 인쇄 */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Printer className="w-4 h-4 text-primary" /> {tr("QR 라벨 인쇄", "QR标签打印")}
          </h3>
          <QrLabelPrintPanel kind="tshirt" orderId={order.id} orderNo={order.external_order_id} items={labelItems} />
        </div>
      </div>
    </div>
  );
}

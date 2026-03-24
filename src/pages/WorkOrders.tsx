import React, { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus, Search, Edit, Eye } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Database } from "@/integrations/supabase/types";

type OrderStatus = Database["public"]["Enums"]["order_status"];

const ORDER_STATUSES: OrderStatus[] = ["received", "in_production", "completed", "shipped", "cancelled"];

export default function WorkOrders() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState({
    external_order_id: "",
    product_code: "",
    design_code: "",
    quantity: "",
    recipient_name: "",
    recipient_phone: "",
    shipping_address: "",
    shipping_city: "",
    shipping_state: "",
    shipping_zip: "",
    shipping_country: "US",
    status: "received" as OrderStatus,
  });

  const resetForm = () => setForm({
    external_order_id: "", product_code: "", design_code: "", quantity: "",
    recipient_name: "", recipient_phone: "", shipping_address: "",
    shipping_city: "", shipping_state: "", shipping_zip: "", shipping_country: "US", status: "received",
  });

  const { data: orders, isLoading } = useOrders();

  const statusBadge = (status: string) => {
    switch (status) {
      case "received": return { label: t("status.waiting"), cls: "status-idle" };
      case "in_production": return { label: t("status.inProgress"), cls: "status-running" };
      case "completed": return { label: t("status.completed"), cls: "status-running" };
      case "shipped": return { label: t("status.shipDone"), cls: "status-running" };
      case "cancelled": return { label: isKo ? "취소" : "已取消", cls: "status-stopped" };
      default: return { label: status, cls: "status-idle" };
    }
  };

  const statusLabel: Record<string, string> = {
    received: isKo ? "접수" : "已接单",
    in_production: isKo ? "생산중" : "生产中",
    completed: isKo ? "완료" : "已完成",
    shipped: isKo ? "출고" : "已出库",
    cancelled: isKo ? "취소" : "已取消",
  };

  const filtered = orders?.filter(wo =>
    !search ||
    wo.external_order_id.toLowerCase().includes(search.toLowerCase()) ||
    wo.product_code.toLowerCase().includes(search.toLowerCase()) ||
    wo.recipient_name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const openCreate = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEdit = (order: NonNullable<typeof orders>[number]) => {
    setForm({
      external_order_id: order.external_order_id,
      product_code: order.product_code,
      design_code: order.design_code ?? "",
      quantity: String(order.quantity),
      recipient_name: order.recipient_name,
      recipient_phone: order.recipient_phone ?? "",
      shipping_address: order.shipping_address,
      shipping_city: order.shipping_city ?? "",
      shipping_state: order.shipping_state ?? "",
      shipping_zip: order.shipping_zip ?? "",
      shipping_country: order.shipping_country,
      status: order.status,
    });
    setEditId(order.id);
  };

  const handleSave = async () => {
    if (!form.external_order_id || !form.product_code || !form.recipient_name || !form.quantity) {
      toast({ title: isKo ? "오류" : "错误", description: isKo ? "필수 항목을 입력해주세요" : "请填写必填项", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        external_order_id: form.external_order_id,
        product_code: form.product_code,
        design_code: form.design_code || null,
        quantity: parseInt(form.quantity) || 1,
        recipient_name: form.recipient_name,
        recipient_phone: form.recipient_phone || null,
        shipping_address: form.shipping_address,
        shipping_city: form.shipping_city || null,
        shipping_state: form.shipping_state || null,
        shipping_zip: form.shipping_zip || null,
        shipping_country: form.shipping_country || "US",
        status: form.status,
      };

      if (editId) {
        const { error } = await supabase.from("orders").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("orders").insert(payload);
        if (error) throw error;
      }

      toast({ title: isKo ? "저장 완료" : "保存成功" });
      setCreateOpen(false);
      setEditId(null);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      toast({ title: isKo ? "오류" : "错误", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const headers = [
    t("workOrders.orderNo"), t("workOrders.productCode"), t("workOrders.designCode"),
    t("workOrders.qty"), isKo ? "수취인" : "收件人",
    isKo ? "배송지" : "配送地址", t("workOrders.status"), isKo ? "관리" : "管理",
  ];

  const detailOrder = detailId ? orders?.find(o => o.id === detailId) : null;

  const OrderFormDialog = ({ open, onOpenChange, title }: { open: boolean; onOpenChange: (v: boolean) => void; title: string }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="space-y-1.5">
            <Label>{isKo ? "주문번호 *" : "订单号 *"}</Label>
            <Input value={form.external_order_id} onChange={e => setForm(f => ({ ...f, external_order_id: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "상품코드 *" : "商品代码 *"}</Label>
            <Input value={form.product_code} onChange={e => setForm(f => ({ ...f, product_code: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "디자인코드" : "设计代码"}</Label>
            <Input value={form.design_code} onChange={e => setForm(f => ({ ...f, design_code: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "수량 *" : "数量 *"}</Label>
            <Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "수취인 *" : "收件人 *"}</Label>
            <Input value={form.recipient_name} onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "연락처" : "联系方式"}</Label>
            <Input value={form.recipient_phone} onChange={e => setForm(f => ({ ...f, recipient_phone: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>{isKo ? "배송 주소" : "配送地址"}</Label>
            <Input value={form.shipping_address} onChange={e => setForm(f => ({ ...f, shipping_address: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "도시" : "城市"}</Label>
            <Input value={form.shipping_city} onChange={e => setForm(f => ({ ...f, shipping_city: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "주/지역" : "省/州"}</Label>
            <Input value={form.shipping_state} onChange={e => setForm(f => ({ ...f, shipping_state: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "우편번호" : "邮编"}</Label>
            <Input value={form.shipping_zip} onChange={e => setForm(f => ({ ...f, shipping_zip: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>{isKo ? "국가" : "国家"}</Label>
            <Input value={form.shipping_country} onChange={e => setForm(f => ({ ...f, shipping_country: e.target.value }))} />
          </div>
          {editId && (
            <div className="space-y-1.5">
              <Label>{isKo ? "상태" : "状态"}</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as OrderStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="col-span-2 flex justify-end gap-2 pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{isKo ? "취소" : "取消"}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (isKo ? "저장중..." : "保存中...") : (isKo ? "저장" : "保存")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return (
    <div>
      <PageHeader title={t("workOrders.title")} description={t("workOrders.desc")}>
        <Button size="sm" className="gap-1.5" onClick={openCreate}><Plus className="w-4 h-4" /> {t("workOrders.create")}</Button>
      </PageHeader>
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: isKo ? "전체" : "全部", value: orders?.length ?? 0 },
            { label: t("status.waiting"), value: orders?.filter(o => o.status === "received").length ?? 0 },
            { label: t("status.inProgress"), value: orders?.filter(o => o.status === "in_production").length ?? 0 },
            { label: t("status.completed"), value: orders?.filter(o => o.status === "completed").length ?? 0 },
            { label: t("status.shipDone"), value: orders?.filter(o => o.status === "shipped").length ?? 0 },
          ].map((s, i) => (
            <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
              <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("workOrders.search")} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {headers.map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wo => {
                    const sb = statusBadge(wo.status);
                    return (
                      <tr key={wo.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-primary pr-4">{wo.external_order_id}</td>
                        <td className="py-2.5 pr-4">{wo.product_code}</td>
                        <td className="py-2.5 pr-4">{wo.design_code ?? "-"}</td>
                        <td className="py-2.5 tabular-nums pr-4">{wo.quantity.toLocaleString()}</td>
                        <td className="py-2.5 pr-4">{wo.recipient_name}</td>
                        <td className="py-2.5 pr-4 max-w-[200px] truncate text-muted-foreground">
                          {[wo.shipping_city, wo.shipping_state, wo.shipping_country].filter(Boolean).join(", ")}
                        </td>
                        <td className="py-2.5 pr-4"><span className={`status-badge ${sb.cls}`}>{sb.label}</span></td>
                        <td className="py-2.5">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailId(wo.id)} title={isKo ? "상세" : "详情"}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(wo)} title={isKo ? "수정" : "编辑"}>
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={headers.length} className="py-8 text-center text-muted-foreground">{isKo ? "주문이 없습니다" : "暂无订单"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <OrderFormDialog open={createOpen} onOpenChange={setCreateOpen} title={isKo ? "작업지시 생성" : "创建工单"} />

      {/* Edit Dialog */}
      <OrderFormDialog open={!!editId} onOpenChange={(v) => { if (!v) setEditId(null); }} title={isKo ? "작업지시 수정" : "编辑工单"} />

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(v) => { if (!v) setDetailId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{isKo ? "주문 상세" : "订单详情"}</DialogTitle></DialogHeader>
          {detailOrder && (
            <div className="space-y-3 text-sm">
              {[
                [isKo ? "주문번호" : "订单号", detailOrder.external_order_id],
                [isKo ? "상품코드" : "商品代码", detailOrder.product_code],
                [isKo ? "디자인코드" : "设计代码", detailOrder.design_code ?? "-"],
                [isKo ? "수량" : "数量", String(detailOrder.quantity)],
                [isKo ? "수취인" : "收件人", detailOrder.recipient_name],
                [isKo ? "연락처" : "联系方式", detailOrder.recipient_phone ?? "-"],
                [isKo ? "주소" : "地址", detailOrder.shipping_address],
                [isKo ? "도시" : "城市", detailOrder.shipping_city ?? "-"],
                [isKo ? "주/지역" : "省/州", detailOrder.shipping_state ?? "-"],
                [isKo ? "우편번호" : "邮编", detailOrder.shipping_zip ?? "-"],
                [isKo ? "국가" : "国家", detailOrder.shipping_country],
                [isKo ? "상태" : "状态", statusLabel[detailOrder.status] ?? detailOrder.status],
                [isKo ? "생성일" : "创建日期", new Date(detailOrder.created_at).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

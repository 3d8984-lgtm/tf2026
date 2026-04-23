import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type QrCategory = "tshirt" | "silicon" | "design" | "hologram";

interface ColumnDef {
  key: string;
  ko: string;
  zh: string;
}

const categoryConfig: Record<QrCategory, { table: string; columns: ColumnDef[]; queryKey: string }> = {
  tshirt: {
    table: "qr_tshirt_master",
    queryKey: "qr_tshirt_master",
    columns: [
      { key: "qr_value", ko: "QR 값", zh: "QR值" },
      { key: "color", ko: "색상", zh: "颜色" },
      { key: "size", ko: "사이즈", zh: "尺码" },
      { key: "product_code", ko: "상품코드", zh: "商品代码" },
    ],
  },
  silicon: {
    table: "qr_silicon_master",
    queryKey: "qr_silicon_master",
    columns: [
      { key: "qr_value", ko: "QR 값", zh: "QR值" },
      { key: "serial_number", ko: "시리얼번호", zh: "序列号" },
      { key: "product_code", ko: "상품코드", zh: "商品代码" },
    ],
  },
  design: {
    table: "qr_design_master",
    queryKey: "qr_design_master",
    columns: [
      { key: "qr_value", ko: "QR 값", zh: "QR值" },
      { key: "design_code", ko: "디자인코드", zh: "设计代码" },
      { key: "design_name", ko: "디자인명", zh: "设计名" },
    ],
  },
  hologram: {
    table: "qr_hologram_master",
    queryKey: "qr_hologram_master",
    columns: [
      { key: "qr_value", ko: "QR 값", zh: "QR值" },
      { key: "serial_number", ko: "시리얼번호", zh: "序列号" },
      { key: "hologram_type", ko: "홀로그램 타입", zh: "全息类型" },
    ],
  },
};

const categoryLabels: Record<QrCategory, { ko: string; zh: string }> = {
  tshirt: { ko: "티셔츠 QR", zh: "T恤QR" },
  silicon: { ko: "실리콘 QR", zh: "硅胶QR" },
  design: { ko: "디자인 QR", zh: "设计QR" },
  hologram: { ko: "홀로그램 QR", zh: "全息QR" },
};

export default function QrMasterManagement({ category }: { category: QrCategory }) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const queryClient = useQueryClient();
  const config = categoryConfig[category];
  const label = isKo ? categoryLabels[category].ko : categoryLabels[category].zh;

  const [search, setSearch] = useState("");
  const [editDialog, setEditDialog] = useState<{ mode: "add" | "edit"; item?: any } | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [config.queryKey],
    queryFn: async () => {
      const { data, error } = await supabase.from(config.table as any).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const filteredRows = rows.filter((row) =>
    search === "" || Object.values(row).some((v) => typeof v === "string" && v.toLowerCase().includes(search.toLowerCase()))
  );

  const openAdd = () => {
    const empty: Record<string, string> = {};
    config.columns.forEach((c) => (empty[c.key] = ""));
    setFormValues(empty);
    setEditDialog({ mode: "add" });
  };

  const openEdit = (item: any) => {
    const vals: Record<string, string> = {};
    config.columns.forEach((c) => (vals[c.key] = item[c.key] ?? ""));
    setFormValues(vals);
    setEditDialog({ mode: "edit", item });
  };

  const handleSave = async () => {
    if (!editDialog) return;
    if (editDialog.mode === "add") {
      const { error } = await supabase.from(config.table as any).insert(formValues as any);
      if (error) { toast.error(error.message); return; }
      toast.success(isKo ? "항목이 추가되었습니다" : "已添加项目");
    } else if (editDialog.item) {
      const { error } = await supabase.from(config.table as any).update(formValues as any).eq("id", editDialog.item.id);
      if (error) { toast.error(error.message); return; }
      toast.success(isKo ? "항목이 수정되었습니다" : "已修改项目");
    }
    queryClient.invalidateQueries({ queryKey: [config.queryKey] });
    setEditDialog(null);
  };

  const handleDelete = async (item: any) => {
    const { error } = await supabase.from(config.table as any).delete().eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    toast.success(isKo ? "항목이 삭제되었습니다" : "已删除项目");
    queryClient.invalidateQueries({ queryKey: [config.queryKey] });
  };

  return (
    <div className="kpi-card section-enter">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold">{label} ({isKo ? "목록" : "列表"}) · {rows.length}{isKo ? "건" : "条"}</h3>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input className="pl-8 h-8 text-xs w-full sm:w-48" placeholder={isKo ? "검색..." : "搜索..."} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5" />
            {isKo ? "추가" : "添加"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40">
              {config.columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">{isKo ? c.ko : c.zh}</th>
              ))}
              <th className="px-3 py-2 text-center font-medium text-muted-foreground text-xs w-24">{isKo ? "관리" : "操作"}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={config.columns.length + 1} className="px-3 py-8 text-center text-muted-foreground text-sm">{isKo ? "로딩 중..." : "加载中..."}</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={config.columns.length + 1} className="px-3 py-8 text-center text-muted-foreground text-sm">{isKo ? "데이터가 없습니다" : "暂无数据"}</td></tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                  {config.columns.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-sm">{row[c.key] ?? "-"}</td>
                  ))}
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}><Pencil className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(row)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editDialog} onOpenChange={(o) => !o && setEditDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editDialog?.mode === "add" ? (isKo ? "항목 추가" : "添加项目") : (isKo ? "항목 수정" : "修改项目")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {config.columns.map((c) => (
              <div key={c.key} className="space-y-1">
                <Label className="text-xs">{isKo ? c.ko : c.zh}</Label>
                <Input className="h-8 text-sm" value={formValues[c.key] ?? ""} onChange={(e) => setFormValues({ ...formValues, [c.key]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDialog(null)}>{isKo ? "취소" : "取消"}</Button>
            <Button size="sm" onClick={handleSave}>{isKo ? "저장" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

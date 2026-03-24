import PageHeader from "@/components/PageHeader";
import { Database, ChevronRight, Search, Plus, Pencil, Trash2, X } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type MasterCategory = "product" | "card" | "shipper";

interface MasterItem {
  id: string;
  [key: string]: string;
}

const demoData: Record<MasterCategory, { columns: { key: string; ko: string; zh: string }[]; rows: MasterItem[] }> = {
  product: {
    columns: [
      { key: "code", ko: "상품코드", zh: "商品代码" },
      { key: "name", ko: "상품명", zh: "商品名" },
      { key: "size", ko: "사이즈", zh: "尺码" },
      { key: "color", ko: "컬러", zh: "颜色" },
      { key: "type", ko: "종류", zh: "种类" },
    ],
    rows: [
      { id: "P001", code: "TS-BK-M", name: "베이직 티셔츠", size: "M", color: "Black", type: "반팔" },
      { id: "P002", code: "TS-WH-L", name: "프리미엄 티셔츠", size: "L", color: "White", type: "반팔" },
      { id: "P003", code: "TS-NV-S", name: "오버핏 티셔츠", size: "S", color: "Navy", type: "반팔" },
      { id: "P004", code: "TS-GR-XL", name: "스탠다드 티셔츠", size: "XL", color: "Gray", type: "긴팔" },
      { id: "P005", code: "TS-RD-M", name: "컬러 에디션", size: "M", color: "Red", type: "반팔" },
    ],
  },
  card: {
    columns: [
      { key: "code", ko: "카드코드", zh: "卡片代码" },
      { key: "name", ko: "카드명", zh: "卡片名" },
      { key: "grade", ko: "등급", zh: "等级" },
      { key: "series", ko: "시리즈", zh: "系列" },
    ],
    rows: [
      { id: "C001", code: "CRD-S-001", name: "스타터 카드", grade: "S", series: "시즌1" },
      { id: "C002", code: "CRD-A-001", name: "프리미엄 카드", grade: "A", series: "시즌1" },
      { id: "C003", code: "CRD-SS-001", name: "레전더리 카드", grade: "SS", series: "시즌1" },
      { id: "C004", code: "CRD-B-001", name: "베이직 카드", grade: "B", series: "시즌2" },
      { id: "C005", code: "CRD-S-002", name: "스페셜 에디션", grade: "S", series: "시즌2" },
    ],
  },
  shipper: {
    columns: [
      { key: "name", ko: "택배사/출고처명", zh: "快递公司/出库方" },
      { key: "code", ko: "코드", zh: "代码" },
      { key: "contact", ko: "연락처", zh: "联系方式" },
      { key: "apiStatus", ko: "API 연동", zh: "API对接" },
    ],
    rows: [
      { id: "S001", name: "CJ대한통운", code: "CJ", contact: "1588-1255", apiStatus: "연동됨" },
      { id: "S002", name: "한진택배", code: "HANJIN", contact: "1588-0011", apiStatus: "미연동" },
      { id: "S003", name: "롯데택배", code: "LOTTE", contact: "1588-2121", apiStatus: "미연동" },
      { id: "S004", name: "EMS", code: "EMS", contact: "1588-1300", apiStatus: "연동됨" },
      { id: "S005", name: "DHL", code: "DHL", contact: "1588-0001", apiStatus: "미연동" },
    ],
  },
};

export default function MasterData() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  const [selected, setSelected] = useState<MasterCategory | null>(null);
  const [search, setSearch] = useState("");
  const [data, setData] = useState(demoData);
  const [editDialog, setEditDialog] = useState<{ mode: "add" | "edit"; item?: MasterItem } | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const masters: { key: MasterCategory; label: string; count: number; lastUpdate: string }[] = [
    { key: "product", label: t("master.product"), count: data.product.rows.length, lastUpdate: "2024-03-15" },
    { key: "card", label: t("master.cardMaster"), count: data.card.rows.length, lastUpdate: "2024-03-15" },
    { key: "shipper", label: t("master.shipper"), count: data.shipper.rows.length, lastUpdate: "2024-02-28" },
  ];

  const currentCat = selected ? data[selected] : null;
  const columns = currentCat?.columns ?? [];
  const filteredRows = currentCat?.rows.filter((row) =>
    search === "" || Object.values(row).some((v) => v.toLowerCase().includes(search.toLowerCase()))
  ) ?? [];

  const openAdd = () => {
    if (!selected) return;
    const empty: Record<string, string> = {};
    columns.forEach((c) => (empty[c.key] = ""));
    setFormValues(empty);
    setEditDialog({ mode: "add" });
  };

  const openEdit = (item: MasterItem) => {
    if (!selected) return;
    const vals: Record<string, string> = {};
    columns.forEach((c) => (vals[c.key] = item[c.key] ?? ""));
    setFormValues(vals);
    setEditDialog({ mode: "edit", item });
  };

  const handleSave = () => {
    if (!selected || !editDialog) return;
    const catData = { ...data[selected] };
    if (editDialog.mode === "add") {
      const newItem: MasterItem = { id: `NEW-${Date.now()}`, ...formValues };
      catData.rows = [...catData.rows, newItem];
      toast.success(isKo ? "항목이 추가되었습니다" : "已添加项目");
    } else if (editDialog.item) {
      catData.rows = catData.rows.map((r) =>
        r.id === editDialog.item!.id ? { ...r, ...formValues } : r
      );
      toast.success(isKo ? "항목이 수정되었습니다" : "已修改项目");
    }
    setData({ ...data, [selected]: catData });
    setEditDialog(null);
  };

  const handleDelete = (item: MasterItem) => {
    if (!selected) return;
    const catData = { ...data[selected] };
    catData.rows = catData.rows.filter((r) => r.id !== item.id);
    setData({ ...data, [selected]: catData });
    toast.success(isKo ? "항목이 삭제되었습니다" : "已删除项目");
  };

  return (
    <div>
      <PageHeader title={t("master.title")} description={t("master.desc")} />
      <div className="p-6 space-y-6">
        {/* Category cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {masters.map((m, i) => (
            <div
              key={m.key}
              onClick={() => { setSelected(selected === m.key ? null : m.key); setSearch(""); }}
              className={`kpi-card section-enter cursor-pointer transition-all ${
                selected === m.key
                  ? "border-primary ring-1 ring-primary/30"
                  : "hover:border-primary/30"
              }`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.count.toLocaleString()}{t("master.items")} · {t("master.lastUpdate")} {m.lastUpdate}
                  </p>
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${selected === m.key ? "rotate-90" : ""}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Detail table */}
        {selected && currentCat && (
          <div className="kpi-card section-enter">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-semibold">
                {masters.find((m) => m.key === selected)?.label} ({isKo ? "목록" : "列表"})
              </h3>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    className="pl-8 h-8 text-xs w-full sm:w-48"
                    placeholder={isKo ? "검색..." : "搜索..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
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
                    {columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">
                        {isKo ? c.ko : c.zh}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center font-medium text-muted-foreground text-xs w-24">
                      {isKo ? "관리" : "操作"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-muted-foreground text-sm">
                        {isKo ? "데이터가 없습니다" : "暂无数据"}
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                        {columns.map((c) => (
                          <td key={c.key} className="px-3 py-2 text-sm">{row[c.key] ?? "-"}</td>
                        ))}
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(row)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(row)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={!!editDialog} onOpenChange={(o) => !o && setEditDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editDialog?.mode === "add"
                ? (isKo ? "항목 추가" : "添加项目")
                : (isKo ? "항목 수정" : "修改项目")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {columns.map((c) => (
              <div key={c.key} className="space-y-1">
                <Label className="text-xs">{isKo ? c.ko : c.zh}</Label>
                <Input
                  className="h-8 text-sm"
                  value={formValues[c.key] ?? ""}
                  onChange={(e) => setFormValues({ ...formValues, [c.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditDialog(null)}>
              {isKo ? "취소" : "取消"}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {isKo ? "저장" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

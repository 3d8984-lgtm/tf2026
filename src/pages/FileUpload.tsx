import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, CheckCircle2, XCircle, Download, FileUp, Info, Image } from "lucide-react";
import { useState } from "react";
import { useLang } from "@/contexts/LangContext";

export default function FileUpload() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<null | {
    fileName: string;
    total: number;
    success: number;
    error: number;
    columnResults: { col: string; category: string; label: string; filled: number; empty: number; error: number }[];
  }>(null);

  // Sheet1: Row1 = category, Row2 = field name (matching the template)
  const columnSpec = [
    { col: "A", category: isKo ? "주문확인" : "订单确认", key: "work_order_no", label: isKo ? "작업지시번호" : "作业指示编号" },
    { col: "B", category: isKo ? "주문확인" : "订单确认", key: "order_no", label: isKo ? "주문번호" : "订单号" },
    { col: "C", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_size", label: isKo ? "티셔츠 사이즈" : "T恤尺码" },
    { col: "D", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_color", label: isKo ? "티셔츠 컬러" : "T恤颜色" },
    { col: "E", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_type", label: isKo ? "티셔츠 종류" : "T恤种类" },
    { col: "F", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_serial", label: isKo ? "티셔츠 일련번호" : "T恤序列号" },
    { col: "G", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "silicon_qr", label: isKo ? "실리콘 마크QR값" : "硅胶标记QR值" },
    { col: "H", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "design_qr", label: isKo ? "디자인QR값" : "设计QR值" },
    { col: "I", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "hologram_qr", label: isKo ? "홀로그램QR값" : "全息QR值" },
    { col: "J", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_barcode", label: isKo ? "카드 바코드값" : "卡片条码值" },
    { col: "K", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_grade", label: isKo ? "카드 등급" : "卡片等级" },
    { col: "L", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_serial", label: isKo ? "카드 일련번호" : "卡片序列号" },
    { col: "M", category: isKo ? "택배송장정보" : "快递面单信息", key: "country_code", label: isKo ? "나라기호" : "国家代码" },
    { col: "N", category: isKo ? "택배송장정보" : "快递面单信息", key: "recipient", label: isKo ? "수취인명" : "收件人" },
    { col: "O", category: isKo ? "택배송장정보" : "快递面单信息", key: "phone", label: isKo ? "연락처" : "联系方式" },
    { col: "P", category: isKo ? "택배송장정보" : "快递面单信息", key: "address", label: isKo ? "주소" : "地址" },
    { col: "Q", category: isKo ? "택배송장정보" : "快递面单信息", key: "zipcode", label: isKo ? "우편번호" : "邮编" },
  ];

  const columnGroups = [
    { label: isKo ? "주문확인" : "订单确认", cols: "A~B", color: "bg-blue-500/10 text-blue-700" },
    { label: isKo ? "티셔츠 작업용" : "T恤作业用", cols: "C~I", color: "bg-violet-500/10 text-violet-700" },
    { label: isKo ? "카드 포장용" : "卡片包装用", cols: "J~L", color: "bg-emerald-500/10 text-emerald-700" },
    { label: isKo ? "택배송장정보" : "快递面单信息", cols: "M~Q", color: "bg-sky-500/10 text-sky-700" },
  ];

  // Unique categories for group badges (from template Row 1)
  const categoryBadges = [
    { label: isKo ? "주문확인" : "订单确认", cols: "A~B" },
    { label: isKo ? "티셔츠 작업용" : "T恤作业用", cols: "C~I" },
    { label: isKo ? "카드 포장용" : "卡片包装用", cols: "J~L" },
    { label: isKo ? "택배송장정보" : "快递面单信息", cols: "M~Q" },
  ];

  const handleDownloadTemplate = () => {
    const link = document.createElement("a");
    link.href = "/template.xlsx";
    link.download = "템플릿.xlsx";
    link.click();
  };

  const handleUploadDemo = () => {
    setUploadResult({
      fileName: "master_data_20240315.xlsx",
      total: 2400,
      success: 2391,
      error: 9,
      columnResults: [
        { col: "A", category: isKo ? "주문확인" : "订单确认", label: isKo ? "작업지시번호" : "作业指示编号", filled: 2400, empty: 0, error: 0 },
        { col: "B", category: isKo ? "주문확인" : "订单确认", label: isKo ? "주문번호" : "订单号", filled: 2400, empty: 0, error: 2 },
        { col: "C", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "티셔츠 사이즈" : "T恤尺码", filled: 2400, empty: 0, error: 0 },
        { col: "D", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "티셔츠 컬러" : "T恤颜色", filled: 2400, empty: 0, error: 0 },
        { col: "E", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "티셔츠 종류" : "T恤种类", filled: 2400, empty: 0, error: 0 },
        { col: "F", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "티셔츠 일련번호" : "T恤序列号", filled: 2400, empty: 0, error: 0 },
        { col: "G", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "실리콘 마크QR값" : "硅胶标记QR值", filled: 2400, empty: 0, error: 2 },
        { col: "H", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "디자인QR값" : "设计QR值", filled: 1800, empty: 600, error: 0 },
        { col: "I", category: isKo ? "티셔츠 작업용" : "T恤作业用", label: isKo ? "홀로그램QR값" : "全息QR值", filled: 2400, empty: 0, error: 0 },
        { col: "J", category: isKo ? "카드 포장용" : "卡片包装用", label: isKo ? "카드 바코드값" : "卡片条码值", filled: 2200, empty: 200, error: 5 },
        { col: "K", category: isKo ? "카드 포장용" : "卡片包装用", label: isKo ? "카드 등급" : "卡片等级", filled: 2200, empty: 200, error: 0 },
        { col: "L", category: isKo ? "카드 포장용" : "卡片包装用", label: isKo ? "카드 일련번호" : "卡片序列号", filled: 2200, empty: 200, error: 0 },
        { col: "M", category: isKo ? "택배송장정보" : "快递面单信息", label: isKo ? "나라기호" : "国家代码", filled: 860, empty: 1540, error: 0 },
        { col: "N", category: isKo ? "택배송장정보" : "快递面单信息", label: isKo ? "수취인명" : "收件人", filled: 860, empty: 1540, error: 0 },
        { col: "O", category: isKo ? "택배송장정보" : "快递面单信息", label: isKo ? "연락처" : "联系方式", filled: 860, empty: 1540, error: 0 },
        { col: "P", category: isKo ? "택배송장정보" : "快递面单信息", label: isKo ? "주소" : "地址", filled: 860, empty: 1540, error: 0 },
        { col: "Q", category: isKo ? "택배송장정보" : "快递面单信息", label: isKo ? "우편번호" : "邮编", filled: 858, empty: 1542, error: 0 },
      ],
    });
  };

  const uploadHistory = [
    { file: "master_data_20240315.xlsx", rows: 2400, success: 2391, error: 9, date: "2024-03-15 09:23", user: isKo ? "김관리" : "金管理" },
    { file: "master_data_20240314.xlsx", rows: 2100, success: 2100, error: 0, date: "2024-03-14 16:45", user: isKo ? "박생산" : "朴生产" },
    { file: "master_data_20240313.xlsx", rows: 1950, success: 1942, error: 8, date: "2024-03-13 10:12", user: isKo ? "김관리" : "金管理" },
  ];

  return (
    <div>
      <PageHeader title={t("upload.title")} description={t("upload.desc")} />
      <div className="p-6 space-y-6">

        {/* Column guide */}
        <div className="kpi-card section-enter flex items-start gap-4">
          <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
            <Info className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">
              {isKo ? "엑셀 템플릿 구조 안내" : "Excel模板结构说明"}
            </h3>
            <p className="text-xs text-muted-foreground mb-1">
              {isKo
                ? "시트1: 1행(카테고리) / 2행(항목명) / 3행부터 데이터 입력"
                : "工作表1: 第1行(类别) / 第2行(字段名) / 第3行起输入数据"}
            </p>
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
              <Image className="w-3.5 h-3.5" />
              {isKo
                ? "시트2: A열(로고 이미지 목록) / B열(로고 이미지 파일)"
                : "工作表2: A列(Logo图片列表) / B列(Logo图片文件)"}
            </p>

            {/* Category badges */}
            <div className="flex flex-wrap gap-2 mb-3">
              {categoryBadges.map((g) => (
                <span key={g.cols} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-muted/30 text-foreground">
                  <span className="font-mono text-[10px] opacity-70">{g.cols}</span>
                  {g.label}
                </span>
              ))}
            </div>

            {/* Column table - field names only (no category column) */}
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                    <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                    <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                    <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.ceil(columnSpec.length / 2) }).map((_, i) => {
                    const left = columnSpec[i * 2];
                    const right = columnSpec[i * 2 + 1];
                    return (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{left.col}</td>
                        <td className="px-2.5 py-1.5">{left.label}</td>
                        {right ? (
                          <>
                            <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{right.col}</td>
                            <td className="px-2.5 py-1.5">{right.label}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-2.5 py-1.5" />
                            <td className="px-2.5 py-1.5" />
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownloadTemplate}>
                <Download className="w-3.5 h-3.5" />
                {isKo ? "템플릿 다운로드" : "下载模板"}
              </Button>
            </div>
          </div>
        </div>

        {/* Drop zone */}
        <div className="kpi-card section-enter" style={{ animationDelay: "60ms" }}>
          <div
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-all duration-200 cursor-pointer ${
              isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleUploadDemo(); }}
            onClick={handleUploadDemo}
          >
            <FileUp className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">{isKo ? "엑셀 파일(.xlsx)을 드래그하거나 클릭하여 업로드" : "拖拽或点击上传Excel文件(.xlsx)"}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("upload.maxSize")}</p>
          </div>
        </div>

        {/* Upload result */}
        {uploadResult && (
          <div className="kpi-card section-enter" style={{ animationDelay: "0ms" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold">{uploadResult.fileName}</h3>
                  <p className="text-xs text-muted-foreground">
                    {isKo ? `총 ${uploadResult.total.toLocaleString()}행` : `共${uploadResult.total.toLocaleString()}行`}
                    {uploadResult.error > 0 && (
                      <span className="text-destructive ml-2">
                        {isKo ? `오류 ${uploadResult.error}건` : `异常${uploadResult.error}条`}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {uploadResult.error > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5">
                  <Download className="w-3.5 h-3.5" />
                  {isKo ? "오류 행 다운로드" : "下载异常行"}
                </Button>
              )}
            </div>

            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs w-10">{isKo ? "열" : "列"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "카테고리" : "类别"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "항목" : "字段"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "입력됨" : "已填"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "빈값" : "空值"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.errorCount")}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-center">{isKo ? "결과" : "结果"}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResult.columnResults.map((c) => (
                    <tr key={c.col} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 font-mono font-semibold text-primary text-xs">{c.col}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.category}</td>
                      <td className="px-3 py-2 font-medium text-sm">{c.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.filled.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.empty > 0 ? c.empty.toLocaleString() : "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.error > 0 ? <span className="text-destructive font-medium">{c.error}</span> : "-"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.error === 0
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                          : <XCircle className="w-4 h-4 text-destructive mx-auto" />
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Upload history */}
        <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
          <h3 className="text-sm font-medium mb-4">{t("upload.history")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">{t("upload.fileName")}</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "행수" : "行数"}</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">{t("upload.successCount")}</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">{t("upload.errorCount")}</th>
                  <th className="pb-2 font-medium text-muted-foreground">{t("upload.dateTime")}</th>
                  <th className="pb-2 font-medium text-muted-foreground">{t("upload.user")}</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {uploadHistory.map((h, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-primary/70" />{h.file}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.rows.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums text-emerald-600">{h.success.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.error > 0 ? <span className="text-destructive">{h.error}</span> : "-"}</td>
                    <td className="py-2.5 text-muted-foreground">{h.date}</td>
                    <td className="py-2.5">{h.user}</td>
                    <td className="py-2.5">{h.error > 0 && <button className="text-xs text-primary hover:underline flex items-center gap-1"><Download className="w-3 h-3" />{t("upload.errorCount")}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

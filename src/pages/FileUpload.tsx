import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, Download, FileUp, Info, Table2 } from "lucide-react";
import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { Badge } from "@/components/ui/badge";

export default function FileUpload() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<null | {
    fileName: string;
    sheets: { name: string; label: string; total: number; success: number; error: number }[];
  }>(null);

  /* Sheet definitions for the integrated file */
  const sheetSpec = [
    { name: "silicon_qr", label: t("upload.siliconQR"), fields: isKo ? "실리콘QR값, 상품코드, 디자인코드, 생산배치번호" : "硅胶QR值, 商品代码, 设计代码, 生产批号" },
    { name: "design_qr", label: t("upload.designQR"), fields: isKo ? "디자인QR값, 상품코드, 디자인코드, SKU, 사이즈" : "设计QR值, 商品代码, 设计代码, SKU, 尺码" },
    { name: "hologram_qr", label: t("upload.hologramQR"), fields: isKo ? "홀로그램QR값, 고유일련번호, 상품코드, 디자인코드" : "全息QR值, 唯一序列号, 商品代码, 设计代码" },
    { name: "card_barcode", label: t("upload.cardBarcode"), fields: isKo ? "카드바코드값, 상품코드, 디자인코드, 카드종류" : "卡片条码值, 商品代码, 设计代码, 卡片类型" },
    { name: "card_serial", label: t("upload.cardSerial"), fields: isKo ? "카드바코드값, 카드일련번호, 디자인코드" : "卡片条码值, 卡片序列号, 设计代码" },
    { name: "logo", label: t("upload.logo"), fields: isKo ? "상품코드, 디자인코드, 로고이미지파일" : "商品代码, 设计代码, Logo图片文件" },
    { name: "shipping", label: t("upload.shippingLabel"), fields: isKo ? "주문번호, 수취인명, 연락처, 주소, 상품코드" : "订单号, 收件人, 联系方式, 地址, 商品代码" },
  ];

  const handleUploadDemo = () => {
    // Demo: simulate upload result
    setUploadResult({
      fileName: "master_data_20240315.xlsx",
      sheets: [
        { name: "silicon_qr", label: t("upload.siliconQR"), total: 2400, success: 2398, error: 2 },
        { name: "design_qr", label: t("upload.designQR"), total: 1800, success: 1800, error: 0 },
        { name: "hologram_qr", label: t("upload.hologramQR"), total: 2400, success: 2400, error: 0 },
        { name: "card_barcode", label: t("upload.cardBarcode"), total: 3200, success: 3195, error: 5 },
        { name: "card_serial", label: t("upload.cardSerial"), total: 3200, success: 3200, error: 0 },
        { name: "logo", label: t("upload.logo"), total: 48, success: 48, error: 0 },
        { name: "shipping", label: t("upload.shippingLabel"), total: 860, success: 858, error: 2 },
      ],
    });
  };

  const uploadHistory = [
    { file: "master_data_20240315.xlsx", sheets: 7, total: 13908, success: 13899, error: 9, date: "2024-03-15 09:23", user: isKo ? "김관리" : "金管理" },
    { file: "master_data_20240314.xlsx", sheets: 7, total: 12450, success: 12450, error: 0, date: "2024-03-14 16:45", user: isKo ? "박생산" : "朴生产" },
    { file: "master_data_20240313.xlsx", sheets: 5, total: 9800, success: 9792, error: 8, date: "2024-03-13 10:12", user: isKo ? "김관리" : "金管理" },
  ];

  const totalFromResult = uploadResult
    ? uploadResult.sheets.reduce((a, s) => a + s.total, 0)
    : 0;
  const errorFromResult = uploadResult
    ? uploadResult.sheets.reduce((a, s) => a + s.error, 0)
    : 0;

  return (
    <div>
      <PageHeader title={t("upload.title")} description={t("upload.desc")} />
      <div className="p-6 space-y-6">

        {/* Template info */}
        <div className="kpi-card section-enter flex items-start gap-4">
          <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
            <Info className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">{isKo ? "통합 엑셀 파일 업로드" : "上传综合Excel文件"}</h3>
            <p className="text-xs text-muted-foreground mb-3">
              {isKo
                ? "하나의 엑셀 파일에 아래 7개 시트를 포함하여 업로드하세요. 시트명이 정확히 일치해야 합니다."
                : "请上传包含以下7个工作表的Excel文件。工作表名称必须完全匹配。"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {sheetSpec.map((s, i) => (
                <div key={s.name} className="flex items-start gap-2 p-2 rounded-md border border-border/60 bg-muted/30">
                  <Badge variant="outline" className="shrink-0 mt-0.5 text-[10px] tabular-nums w-5 h-5 flex items-center justify-center p-0 rounded-full">
                    {i + 1}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.fields}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
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
            <p className="text-sm font-medium">{isKo ? "통합 엑셀 파일(.xlsx)을 드래그하거나 클릭하여 업로드" : "拖拽或点击上传综合Excel文件(.xlsx)"}</p>
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
                    {isKo ? `총 ${totalFromResult.toLocaleString()}건` : `共${totalFromResult.toLocaleString()}条`}
                    {errorFromResult > 0 && (
                      <span className="text-destructive ml-2">
                        {isKo ? `오류 ${errorFromResult}건` : `异常${errorFromResult}条`}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {errorFromResult > 0 && (
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
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "시트" : "工作表"}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.totalCount")}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.successCount")}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.errorCount")}</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-center">{isKo ? "결과" : "结果"}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadResult.sheets.map((s) => (
                    <tr key={s.name} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2.5 flex items-center gap-2">
                        <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-medium">{s.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.total.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600">{s.success.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {s.error > 0 ? <span className="text-destructive font-medium">{s.error}</span> : "-"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {s.error === 0
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
                  <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "시트" : "工作表"}</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">{t("upload.totalCount")}</th>
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
                    <td className="py-2.5 text-right tabular-nums">{h.sheets}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.total.toLocaleString()}</td>
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

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, Download } from "lucide-react";
import { useState } from "react";
import { useLang } from "@/contexts/LangContext";

export default function FileUpload() {
  const { t } = useLang();
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const uploadTypes = [
    { id: "silicon_qr", label: t("upload.siliconQR"), fields: lang("ko") ? "실리콘QR값, 상품코드, 디자인코드, 생산배치번호" : "硅胶QR值, 商品代码, 设计代码, 生产批号" },
    { id: "design_qr", label: t("upload.designQR"), fields: lang("ko") ? "디자인QR값, 상품코드, 디자인코드, SKU, 사이즈" : "设计QR值, 商品代码, 设计代码, SKU, 尺码" },
    { id: "hologram_qr", label: t("upload.hologramQR"), fields: lang("ko") ? "홀로그램QR값, 고유일련번호, 상품코드, 디자인코드" : "全息QR值, 唯一序列号, 商品代码, 设计代码" },
    { id: "card_barcode", label: t("upload.cardBarcode"), fields: lang("ko") ? "카드바코드값, 상품코드, 디자인코드, 카드종류" : "卡片条码值, 商品代码, 设计代码, 卡片类型" },
    { id: "card_serial", label: t("upload.cardSerial"), fields: lang("ko") ? "카드바코드값, 카드일련번호, 디자인코드" : "卡片条码值, 卡片序列号, 设计代码" },
    { id: "logo", label: t("upload.logo"), fields: lang("ko") ? "상품코드, 디자인코드, 로고이미지파일" : "商品代码, 设计代码, Logo图片文件" },
    { id: "shipping", label: t("upload.shippingLabel"), fields: lang("ko") ? "주문번호, 수취인명, 연락처, 주소, 상품코드" : "订单号, 收件人, 联系方式, 地址, 商品代码" },
  ];

  const uploadHistory = [
    { file: "silicon_qr_20240315.csv", type: t("upload.siliconQR"), total: 2400, success: 2398, error: 2, date: "2024-03-15 09:23", user: lang("ko") ? "김관리" : "金管理" },
    { file: "design_qr_20240315.xlsx", type: t("upload.designQR"), total: 1800, success: 1800, error: 0, date: "2024-03-15 09:18", user: lang("ko") ? "김관리" : "金管理" },
    { file: "card_barcode_20240314.csv", type: t("upload.cardBarcode"), total: 3200, success: 3195, error: 5, date: "2024-03-14 16:45", user: lang("ko") ? "박생산" : "朴生产" },
  ];

  function lang(l: string) { return t("app.name") && l === "ko" ? !t("menu.dashboard").includes("仪") : t("menu.dashboard").includes("仪"); }

  return (
    <div>
      <PageHeader title={t("upload.title")} description={t("upload.desc")} />
      <div className="p-6 space-y-6">
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">{t("upload.selectType")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {uploadTypes.map((tp) => (
              <button key={tp.id} onClick={() => setSelectedType(tp.id)}
                className={`p-3 rounded-lg border text-sm text-left transition-all duration-150 active:scale-[0.97] ${
                  selectedType === tp.id ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/40"
                }`}>{tp.label}</button>
            ))}
          </div>
        </div>

        {selectedType && (
          <div className="kpi-card section-enter">
            <h3 className="text-sm font-medium mb-1">{uploadTypes.find(tp => tp.id === selectedType)?.label} {t("upload.title")}</h3>
            <p className="text-xs text-muted-foreground mb-4">{t("upload.requiredFields")}: {uploadTypes.find(tp => tp.id === selectedType)?.fields}</p>
            <div className="border-2 border-dashed rounded-lg p-12 text-center hover:border-primary/40 transition-colors cursor-pointer">
              <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{t("upload.dropzone")}</p>
              <p className="text-xs text-muted-foreground mt-1">{t("upload.maxSize")}</p>
            </div>
          </div>
        )}

        <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
          <h3 className="text-sm font-medium mb-4">{t("upload.history")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">{t("upload.fileName")}</th>
                  <th className="pb-2 font-medium text-muted-foreground">{t("upload.type")}</th>
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
                    <td className="py-2.5 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-muted-foreground" />{h.file}</td>
                    <td className="py-2.5">{h.type}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.total.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums text-success">{h.success.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.error > 0 ? <span className="text-destructive">{h.error}</span> : "-"}</td>
                    <td className="py-2.5 text-muted-foreground">{h.date}</td>
                    <td className="py-2.5">{h.user}</td>
                    <td className="py-2.5">{h.error > 0 && <button className="text-xs text-primary hover:underline flex items-center gap-1"><Download className="w-3 h-3" /> {t("upload.errorCount")}</button>}</td>
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

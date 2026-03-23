import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, Download } from "lucide-react";
import { useState } from "react";

const uploadTypes = [
  { id: "silicon_qr", label: "실리콘 마크 QR", fields: "실리콘QR값, 상품코드, 디자인코드, 생산배치번호" },
  { id: "design_qr", label: "디자인 QR", fields: "디자인QR값, 상품코드, 디자인코드, SKU, 사이즈" },
  { id: "hologram_qr", label: "홀로그램 QR", fields: "홀로그램QR값, 고유일련번호, 상품코드, 디자인코드" },
  { id: "card_barcode", label: "카드 바코드", fields: "카드바코드값, 상품코드, 디자인코드, 카드종류" },
  { id: "card_serial", label: "카드 일련번호", fields: "카드바코드값, 카드일련번호, 디자인코드" },
  { id: "logo", label: "로고 이미지", fields: "상품코드, 디자인코드, 로고이미지파일" },
  { id: "shipping", label: "택배송장", fields: "주문번호, 수취인명, 연락처, 주소, 상품코드" },
];

const uploadHistory = [
  { file: "silicon_qr_20240315.csv", type: "실리콘 마크 QR", total: 2400, success: 2398, error: 2, date: "2024-03-15 09:23", user: "김관리" },
  { file: "design_qr_20240315.xlsx", type: "디자인 QR", total: 1800, success: 1800, error: 0, date: "2024-03-15 09:18", user: "김관리" },
  { file: "card_barcode_20240314.csv", type: "카드 바코드", total: 3200, success: 3195, error: 5, date: "2024-03-14 16:45", user: "박생산" },
];

export default function FileUpload() {
  const [selectedType, setSelectedType] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="파일 업로드" description="기준 데이터를 업로드하여 검증 기준을 설정합니다" />
      <div className="p-6 space-y-6">
        {/* Upload type selection */}
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">업로드 유형 선택</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {uploadTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className={`p-3 rounded-lg border text-sm text-left transition-all duration-150 active:scale-[0.97] ${
                  selectedType === t.id
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:border-primary/40"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Upload area */}
        {selectedType && (
          <div className="kpi-card section-enter">
            <h3 className="text-sm font-medium mb-1">
              {uploadTypes.find(t => t.id === selectedType)?.label} 업로드
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              필수 항목: {uploadTypes.find(t => t.id === selectedType)?.fields}
            </p>
            <div className="border-2 border-dashed rounded-lg p-12 text-center hover:border-primary/40 transition-colors cursor-pointer">
              <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">CSV, XLSX 파일을 드래그하거나 클릭하여 업로드</p>
              <p className="text-xs text-muted-foreground mt-1">최대 10MB · 중복/누락/형식 자동 검증</p>
            </div>
          </div>
        )}

        {/* Upload history */}
        <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
          <h3 className="text-sm font-medium mb-4">업로드 이력</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-muted-foreground">파일명</th>
                  <th className="pb-2 font-medium text-muted-foreground">유형</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">등록</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">정상</th>
                  <th className="pb-2 font-medium text-muted-foreground text-right">오류</th>
                  <th className="pb-2 font-medium text-muted-foreground">일시</th>
                  <th className="pb-2 font-medium text-muted-foreground">사용자</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {uploadHistory.map((h, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
                      {h.file}
                    </td>
                    <td className="py-2.5">{h.type}</td>
                    <td className="py-2.5 text-right tabular-nums">{h.total.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums text-success">{h.success.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {h.error > 0 ? <span className="text-destructive">{h.error}</span> : "-"}
                    </td>
                    <td className="py-2.5 text-muted-foreground">{h.date}</td>
                    <td className="py-2.5">{h.user}</td>
                    <td className="py-2.5">
                      {h.error > 0 && (
                        <button className="text-xs text-primary hover:underline flex items-center gap-1">
                          <Download className="w-3 h-3" /> 오류
                        </button>
                      )}
                    </td>
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

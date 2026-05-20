import PageHeader from "@/components/PageHeader";
import FactoryOrderPanel from "@/components/outsource/FactoryOrderPanel";
import { useLang } from "@/contexts/LangContext";
import { useFactoryOrders } from "@/hooks/useFactoryOrders";

export default function SiliconFactory() {
  const { t } = useLang();
  const { orders } = useFactoryOrders();
  return (
    <div>
      <PageHeader title={t("menu.outSilicon")} description="트윈코드 SVG + 주문일련번호 + QR코드를 합성한 PDF 발주" />
      <div className="p-6">
        <FactoryOrderPanel
          generateLabelKey="out.generatePdf"
          orders={sampleOrders}
          renderPreview={(sel) => (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sel.map(o => (
                <div key={o.orderNo} className="rounded-md border p-4 aspect-[3/4] flex flex-col items-center justify-between">
                  <div className="text-xs text-muted-foreground">PDF Preview</div>
                  <div className="w-24 h-24 border border-dashed rounded flex items-center justify-center text-xs">SVG</div>
                  <div className="text-sm font-mono">{o.orderNo}</div>
                  <div className="w-16 h-16 border border-dashed rounded flex items-center justify-center text-xs">QR</div>
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

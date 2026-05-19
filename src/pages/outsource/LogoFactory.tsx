import PageHeader from "@/components/PageHeader";
import FactoryOrderPanel, { sampleOrders } from "@/components/outsource/FactoryOrderPanel";
import { useLang } from "@/contexts/LangContext";

export default function LogoFactory() {
  const { t } = useLang();
  return (
    <div>
      <PageHeader title={t("menu.outLogo")} description="LOGO 디자인 + 주문수량 × 1.1 (올림) 발주" />
      <div className="p-6">
        <FactoryOrderPanel
          generateLabelKey="out.generateOrderSheet"
          orders={sampleOrders}
          extraColumns={[
            { header: "요청수량 (×1.1)", render: (o) => <span className="font-semibold">{Math.ceil(o.qty * 1.1)}</span> },
          ]}
          renderPreview={(sel) => (
            <div className="space-y-2">
              {sel.map(o => (
                <div key={o.orderNo} className="flex justify-between border rounded-md p-3">
                  <div className="font-mono">{o.orderNo}</div>
                  <div>주문 {o.qty} → 요청 <span className="font-semibold">{Math.ceil(o.qty * 1.1)}</span></div>
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

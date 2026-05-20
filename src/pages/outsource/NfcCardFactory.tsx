import PageHeader from "@/components/PageHeader";
import FactoryOrderPanel from "@/components/outsource/FactoryOrderPanel";
import { useLang } from "@/contexts/LangContext";
import { useFactoryOrders } from "@/hooks/useFactoryOrders";

export default function NfcCardFactory() {
  const { t } = useLang();
  const { orders } = useFactoryOrders();
  return (
    <div>
      <PageHeader title={t("menu.outNfcCard")} description="앞면/뒷면 PDF 폴더(ZIP) 발주" />
      <div className="p-6">
        <FactoryOrderPanel
          generateLabelKey="out.generateFrontBack"
          downloadLabelKey="out.downloadZip"
          orders={orders}
          renderPreview={(sel) => (
            <div className="space-y-4">
              {sel.map(o => (
                <div key={o.orderNo} className="grid grid-cols-2 gap-4">
                  <div className="rounded-md border p-4 aspect-[1.6/1] flex flex-col justify-between">
                    <div className="text-xs text-muted-foreground">앞면 · {o.orderNo}</div>
                    <div className="text-sm">CP값 · 순번 {o.serial}</div>
                  </div>
                  <div className="rounded-md border p-4 aspect-[1.6/1] flex flex-col justify-between">
                    <div className="text-xs text-muted-foreground">뒷면 · {o.orderNo}</div>
                    <div className="text-xs">트윈코드 · DM바코드 · EDITION · Minted on · 등급 · 싸인</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

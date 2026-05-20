import PageHeader from "@/components/PageHeader";
import FactoryOrderPanel from "@/components/outsource/FactoryOrderPanel";
import { useLang } from "@/contexts/LangContext";
import { Folder, Image as ImageIcon, QrCode } from "lucide-react";
import { useFactoryOrders } from "@/hooks/useFactoryOrders";

export default function HeatTransferFactory() {
  const { t } = useLang();
  const { orders } = useFactoryOrders();
  return (
    <div>
      <PageHeader title={t("menu.outHeatTransfer")} description="디자인 PNG + QR코드 폴더(ZIP) 발주" />
      <div className="p-6">
        <FactoryOrderPanel
          generateLabelKey="out.generateFolder"
          downloadLabelKey="out.downloadZip"
          orders={orders}
          renderPreview={(sel) => (
            <div className="font-mono text-sm space-y-1">
              <div className="flex items-center gap-2"><Folder className="w-4 h-4 text-warning" /> design/</div>
              {sel.map(o => (
                <div key={`d-${o.orderNo}`} className="flex items-center gap-2 pl-6"><ImageIcon className="w-3.5 h-3.5" /> {o.orderNo}.png</div>
              ))}
              <div className="flex items-center gap-2 pt-2"><Folder className="w-4 h-4 text-warning" /> qrcode/</div>
              {sel.map(o => (
                <div key={`q-${o.orderNo}`} className="flex items-center gap-2 pl-6"><QrCode className="w-3.5 h-3.5" /> {o.orderNo}.png</div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

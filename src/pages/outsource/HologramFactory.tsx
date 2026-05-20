import PageHeader from "@/components/PageHeader";
import FactoryOrderPanel, { sampleOrders } from "@/components/outsource/FactoryOrderPanel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLang } from "@/contexts/LangContext";

export default function HologramFactory() {
  const { t } = useLang();
  return (
    <div>
      <PageHeader title={t("menu.outHologram")} description="순번번호 + 주문번호 Excel 발주" />
      <div className="p-6">
        <FactoryOrderPanel
          generateLabelKey="out.generateExcel"
          orders={orders}
          renderPreview={(sel) => (
            <Table>
              <TableHeader>
                <TableRow><TableHead>A: {t("out.serial")}</TableHead><TableHead>B: {t("out.orderNo")}</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {sel.map(o => (
                  <TableRow key={o.orderNo}><TableCell className="font-mono">{o.serial}</TableCell><TableCell className="font-mono">{o.orderNo}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </div>
    </div>
  );
}

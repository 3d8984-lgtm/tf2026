import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useExpectedShipAt } from "@/lib/expected-ship";
import type { FactoryKey } from "@/hooks/useOrderStatus";
import { useLang } from "@/contexts/LangContext";

interface Props {
  factory: FactoryKey;
  orderNo: string;
  className?: string;
}

/**
 * Compact "예정 발송일" (expected ship date from factory to TWINMETA) field.
 * Persists per (factory, orderNo) in localStorage and syncs to the PO card.
 */
export default function ExpectedShipDateField({ factory, orderNo, className }: Props) {
  const [value, setValue] = useExpectedShipAt(factory, orderNo);
  const { lang } = useLang();
  const isKo = lang === "ko";
  return (
    <div className={className}>
      <Label className="text-xs mb-1 block">
        {isKo ? "예정 발송일" : "预计发货日"}
        <span className="ml-1 text-[10px] text-muted-foreground font-normal">
          {isKo ? "(공장 → TWINMETA)" : "(工厂 → TWINMETA)"}
        </span>
      </Label>
      <Input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-xs"
      />
    </div>
  );
}

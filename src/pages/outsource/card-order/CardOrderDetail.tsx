import { useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";

export default function CardOrderDetail() {
  const { id } = useParams();
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="카드 주문 상세" description={`주문 ID: ${id}`} />
      <p className="text-sm text-muted-foreground">PDF 생성 UI는 다음 단계에서 구현됩니다.</p>
    </div>
  );
}

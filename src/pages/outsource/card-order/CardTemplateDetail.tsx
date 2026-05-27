import { useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";

export default function CardTemplateDetail() {
  const { id } = useParams();
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="카드 템플릿 상세" description={`템플릿 ID: ${id}`} />
      <p className="text-sm text-muted-foreground">요소 위치 설정 UI는 다음 단계에서 구현됩니다.</p>
    </div>
  );
}

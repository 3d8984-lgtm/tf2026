import BarcodePrintWorkspace from "@/components/BarcodePrintWorkspace";

export default function CardBarcodePrint() {
  return (
    <BarcodePrintWorkspace
      kind="card"
      suffix="-4"
      titleKo="카드 바코드 인쇄 작업"
      titleZh="卡片条码打印作业"
      listDescKo="주문건을 선택하면 스캔 검증 및 인쇄 모니터링 화면으로 이동합니다"
      listDescZh="选择订单后进入扫描检验与打印监控界面"
      detailListTitleKo="주문 상세 목록 · 카드 고유번호 (스캔 순서)"
      detailListTitleZh="订单明细 · 卡片唯一编号（扫描顺序）"
    />
  );
}

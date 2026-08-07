import BarcodePrintWorkspace from "@/components/BarcodePrintWorkspace";

export default function TshirtBarcodePrint() {
  return (
    <BarcodePrintWorkspace
      kind="tshirt"
      suffix="-3"
      titleKo="티셔츠 바코드 인쇄 작업"
      titleZh="T恤条码打印作业"
      listDescKo="주문건을 선택하면 스티커 고유번호 스캔 검증 및 인쇄 모니터링 화면으로 이동합니다"
      listDescZh="选择订单后进入贴纸唯一编号扫描检验与打印监控界面"
      detailListTitleKo="주문 상세 목록 · 스티커 고유번호 (스캔 순서)"
      detailListTitleZh="订单明细 · 贴纸唯一编号（扫描顺序）"
    />
  );
}

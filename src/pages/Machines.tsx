import PageHeader from "@/components/PageHeader";
import { Wifi, WifiOff, Gauge, AlertTriangle } from "lucide-react";
import OrderPipeline from "@/components/OrderPipeline";
import { useLang } from "@/contexts/LangContext";

export default function Machines() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";

  return (
    <div>
      <PageHeader title={t("machines.title")} description={t("machines.desc")} />
      <div className="p-6 space-y-8">
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">{t("machines.orderPipeline")}</h2>
          <OrderPipeline />
        </div>
        <div>
          <h2 className="text-sm font-semibold mb-4 text-foreground">{t("machines.machineStatus")}</h2>
          <div className="kpi-card py-12 text-center text-muted-foreground">
            <Gauge className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {isKo
                ? "PLC/게이트웨이 연동 후 기계 상태가 실시간으로 표시됩니다"
                : "PLC/网关连接后将实时显示设备状态"}
            </p>
            <p className="text-xs mt-2 text-muted-foreground/60">
              {isKo
                ? "시스템 설정 → 장비 관리에서 장비를 등록해주세요"
                : "请在系统设置 → 设备管理中注册设备"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

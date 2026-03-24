import { useLang } from "@/contexts/LangContext";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { UserPlus, Shirt, RefreshCw, Truck, Cpu, Wrench } from "lucide-react";

const manualSections = [
  {
    id: "user-registration",
    icon: UserPlus,
    titleKey: "manual.section1",
    content: {
      ko: [
        "1. 회원가입 페이지에서 이메일과 비밀번호를 입력하여 가입합니다.",
        "2. 가입 후 관리자 승인이 필요합니다. 승인 전까지 로그인할 수 없습니다.",
        "3. 최고관리자는 [시스템 설정 > 사용자 관리] 탭에서 가입 요청을 확인하고 승인/차단할 수 있습니다.",
        "4. 승인 시 회원등급(현장작업자/생산관리자/최고관리자)을 함께 설정할 수 있습니다.",
        "5. 등급별 접근 가능한 메뉴와 기능이 다르므로, 업무 역할에 맞는 등급을 부여하세요.",
      ],
      zh: [
        "1. 在注册页面输入邮箱和密码进行注册。",
        "2. 注册后需要管理员审批，审批前无法登录。",
        "3. 最高管理员可在 [系统设置 > 用户管理] 标签中查看注册申请并批准/拒绝。",
        "4. 批准时可同时设置会员等级（现场操作员/生产管理员/最高管理员）。",
        "5. 不同等级可访问的菜单和功能不同，请根据工作角色分配等级。",
      ],
    },
  },
  {
    id: "new-tshirt",
    icon: Shirt,
    titleKey: "manual.section2",
    content: {
      ko: [
        "1. [기준정보 관리]에서 새로운 상품 마스터를 등록합니다.",
        "2. 상품코드, 디자인코드, 사이즈, 색상 등 기본 정보를 입력합니다.",
        "3. [파일 업로드]에서 해당 상품의 실리콘 마크 QR, 디자인 QR, 홀로그램 QR 데이터를 업로드합니다.",
        "4. 카드 바코드, 카드 일련번호, 로고 이미지도 함께 등록합니다.",
        "5. [시스템 설정 > 검수 기준]에서 새 상품에 대한 중량 기준 등 검수 조건을 설정합니다.",
        "6. 등록 완료 후 주문이 들어오면 자동으로 생산 공정에 반영됩니다.",
      ],
      zh: [
        "1. 在 [基准信息管理] 中注册新的商品主数据。",
        "2. 输入商品代码、设计代码、尺寸、颜色等基本信息。",
        "3. 在 [文件上传] 中上传该商品的硅胶标记QR、设计QR、全息QR数据。",
        "4. 同时注册卡片条码、卡片序列号、Logo图片。",
        "5. 在 [系统设置 > 检验标准] 中设置新商品的重量标准等检验条件。",
        "6. 注册完成后，订单进入时将自动反映到生产工序中。",
      ],
    },
  },
  {
    id: "twinmeta-sync",
    icon: RefreshCw,
    titleKey: "manual.section3",
    content: {
      ko: [
        "1. TWINMETA 사이트에서 주문 데이터를 수신하는 방법은 두 가지입니다:",
        "   • Webhook 방식: [시스템 설정 > Webhook] 탭에서 Webhook URL을 복사하여 TWINMETA 사이트에 등록합니다.",
        "   • 파일 업로드 방식: [주문 데이터 가져오기 > 파일 업로드] 탭에서 CSV/XLSX 파일로 주문을 일괄 등록합니다.",
        "2. 송장번호 연동: 택배사 API를 통해 발급받은 송장번호는 자동으로 주문에 매핑됩니다.",
        "3. TWINMETA 회신 설정: [시스템 설정 > TWINMETA 회신] 탭에서 콜백 URL과 인증 정보를 설정하면, 배송 상태 변경 시 자동으로 TWINMETA 사이트에 회신합니다.",
        "4. 동기화 옵션(송장번호/배송완료/상태변경)을 선택하여 필요한 정보만 회신할 수 있습니다.",
      ],
      zh: [
        "1. 从TWINMETA站点接收订单数据有两种方式：",
        "   • Webhook方式：在 [系统设置 > Webhook] 标签中复制Webhook URL并在TWINMETA站点中注册。",
        "   • 文件上传方式：在 [订单数据导入 > 文件上传] 标签中通过CSV/XLSX文件批量注册订单。",
        "2. 运单号对接：通过快递公司API获得的运单号将自动映射到订单。",
        "3. TWINMETA回调设置：在 [系统设置 > TWINMETA回调] 标签中设置回调URL和认证信息，配送状态变更时将自动回调TWINMETA站点。",
        "4. 可选择同步选项（运单号/配送完成/状态变更），只回传需要的信息。",
      ],
    },
  },
  {
    id: "courier-api",
    icon: Truck,
    titleKey: "manual.section4",
    content: {
      ko: [
        "1. [시스템 설정 > 택배사 연동] 탭에서 택배사 API 정보를 설정합니다.",
        "2. 택배사별 API Key, API URL, 계약 코드 등을 입력합니다.",
        "3. 연동 가능한 택배사: CJ대한통운, 한진택배, 롯데택배, 우체국 등",
        "4. API 연동 후 [배송 관리]에서 송장 일괄 출력이 가능합니다.",
        "5. 송장 발급 → 부착 → 출고 → 배송 추적까지 자동으로 처리됩니다.",
        "6. API 연결 테스트는 택배사 연동 설정 페이지에서 직접 수행할 수 있습니다.",
      ],
      zh: [
        "1. 在 [系统设置 > 快递对接] 标签中设置快递公司API信息。",
        "2. 输入各快递公司的API Key、API URL、合同代码等。",
        "3. 可对接的快递公司：CJ大韩通运、韩进快递、乐天快递、邮局等",
        "4. API对接后可在 [配送管理] 中批量打印运单。",
        "5. 运单发放 → 贴附 → 出库 → 物流追踪均自动处理。",
        "6. API连接测试可在快递对接设置页面中直接执行。",
      ],
    },
  },
  {
    id: "plc-gateway",
    icon: Cpu,
    titleKey: "manual.section5",
    content: {
      ko: [
        "1. [시스템 설정 > 장비 관리]에서 PLC 장비를 등록합니다.",
        "2. 기계명, 기계코드, PLC IP 주소, 통신 프로토콜(Modbus TCP/OPC-UA 등)을 입력합니다.",
        "3. [PLC 태그] 탭에서 태그명, 주소, 데이터형, 읽기/쓰기 속성을 설정합니다.",
        "4. [센서] 탭에서 센서와 PLC 주소를 매핑하고, 정상/알람 조건을 설정합니다.",
        "5. [명령] 탭에서 PLC에 전송할 제어 명령을 등록합니다.",
        "6. [알람] 탭에서 알람 발생 조건, 알림 대상, 자동 정지 여부를 설정합니다.",
        "7. 게이트웨이 연결 상태는 장비 관리 화면에서 실시간으로 확인할 수 있습니다.",
      ],
      zh: [
        "1. 在 [系统设置 > 设备管理] 中注册PLC设备。",
        "2. 输入设备名、设备代码、PLC IP地址、通信协议（Modbus TCP/OPC-UA等）。",
        "3. 在 [PLC标签] 标签中设置标签名、地址、数据类型、读写属性。",
        "4. 在 [传感器] 标签中映射传感器与PLC地址，设置正常/报警条件。",
        "5. 在 [指令] 标签中注册发送到PLC的控制指令。",
        "6. 在 [报警] 标签中设置报警触发条件、通知对象、自动停机选项。",
        "7. 网关连接状态可在设备管理界面实时查看。",
      ],
    },
  },
  {
    id: "site-modification",
    icon: Wrench,
    titleKey: "manual.section6",
    content: {
      ko: [
        "1. 본 시스템은 Lovable 플랫폼에서 개발·운영됩니다.",
        "2. 사이트 수정이 필요한 경우 Lovable 대시보드에 접속하여 변경합니다.",
        "3. 주요 수정 가능 항목:",
        "   • UI/UX 디자인 변경 (레이아웃, 색상, 폰트 등)",
        "   • 새로운 기능 추가 (메뉴, 페이지, 데이터 처리 로직)",
        "   • 데이터베이스 테이블 구조 변경",
        "   • API 연동 추가/수정",
        "4. 변경 사항은 Lovable의 AI 기능을 통해 자연어로 요청할 수 있습니다.",
        "5. 수정 후 프리뷰에서 확인하고, 이상이 없으면 배포(Publish)합니다.",
        "6. 중요 변경 전에는 현재 버전을 확인하고 변경 이력을 관리하세요.",
      ],
      zh: [
        "1. 本系统在Lovable平台上开发和运营。",
        "2. 如需修改站点，请访问Lovable仪表板进行更改。",
        "3. 主要可修改项：",
        "   • UI/UX设计变更（布局、颜色、字体等）",
        "   • 添加新功能（菜单、页面、数据处理逻辑）",
        "   • 数据库表结构变更",
        "   • 添加/修改API对接",
        "4. 变更事项可通过Lovable的AI功能以自然语言请求。",
        "5. 修改后在预览中确认，无误后发布（Publish）。",
        "6. 重要变更前请确认当前版本并管理变更历史。",
      ],
    },
  },
];

export default function Manual() {
  const { lang, t } = useLang();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader title={t("manual.title")} description={t("manual.desc")} />

      <Card>
        <CardContent className="pt-6">
          <Accordion type="multiple" className="space-y-2">
            {manualSections.map((section) => (
              <AccordionItem key={section.id} value={section.id} className="border rounded-lg px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <section.icon className="w-4 h-4 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-left">{t(section.titleKey)}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pl-11 space-y-2 pb-2">
                    {section.content[lang].map((line, i) => (
                      <p key={i} className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {line}
                      </p>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

import PageHeader from "@/components/PageHeader";
import { useLang } from "@/contexts/LangContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Bell, Shield, Cog, Server, Cpu, Radio, Play, AlertTriangle, Plus, Pencil, Trash2, Wifi, WifiOff, ShieldCheck, Webhook, Truck, ArrowUpRight } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import InspectionStandards from "@/components/InspectionStandards";
import UserManagement from "@/components/UserManagement";
import WebhookSettings from "@/components/WebhookSettings";
import CourierSettings from "@/components/CourierSettings";
import SiteCallbackSettings from "@/components/SiteCallbackSettings";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

/* ── Types ── */
interface Equipment { id: number; name: string; code: string; line: string; plcIp: string; protocol: string; connected: boolean }
interface PlcTag { id: number; tag: string; address: string; dataType: string; rw: string; desc: string }
interface Sensor { id: number; name: string; plcAddr: string; normalCond: string; alarmCond: string }
interface Command { id: number; name: string; code: string; tag: string; value: string; permission: string }
interface Alarm { id: number; name: string; condition: string; target: string; stop: boolean; retry: boolean }

/* ── Initial data ── */
const initEquipment: Equipment[] = [
  { id: 1, name: "티셔츠 제작기 A-1", code: "A-1", line: "LINE-1", plcIp: "192.168.1.10", protocol: "Modbus TCP", connected: true },
  { id: 2, name: "티셔츠 제작기 A-2", code: "A-2", line: "LINE-1", plcIp: "192.168.1.11", protocol: "Modbus TCP", connected: true },
  { id: 3, name: "티셔츠 제작기 A-3", code: "A-3", line: "LINE-1", plcIp: "192.168.1.12", protocol: "OPC-UA", connected: false },
  { id: 4, name: "카드 포장기 B-1", code: "B-1", line: "LINE-2", plcIp: "192.168.1.20", protocol: "Modbus TCP", connected: true },
  { id: 5, name: "티셔츠+카드 포장기 B-2", code: "B-2", line: "LINE-2", plcIp: "192.168.1.21", protocol: "OPC-UA", connected: true },
  { id: 6, name: "중량검사기 B-3", code: "B-3", line: "LINE-3", plcIp: "192.168.1.25", protocol: "Modbus TCP", connected: true },
  { id: 7, name: "택배 포장기 B-4", code: "B-4", line: "LINE-3", plcIp: "192.168.1.30", protocol: "Modbus TCP", connected: true },
  { id: 8, name: "송장 부착기 B-5", code: "B-5", line: "LINE-3", plcIp: "192.168.1.31", protocol: "OPC-UA", connected: false },
];

const initPlcTags: PlcTag[] = [
  { id: 1, tag: "D100", address: "40001", dataType: "INT16", rw: "R", desc: "현재 속도" },
  { id: 2, tag: "D101", address: "40002", dataType: "INT16", rw: "R", desc: "누적 카운트" },
  { id: 3, tag: "D200", address: "40100", dataType: "BOOL", rw: "R/W", desc: "운전 상태" },
  { id: 4, tag: "D201", address: "40101", dataType: "BOOL", rw: "W", desc: "시작 명령" },
  { id: 5, tag: "D202", address: "40102", dataType: "BOOL", rw: "W", desc: "정지 명령" },
  { id: 6, tag: "D300", address: "40200", dataType: "FLOAT", rw: "R", desc: "온도 센서" },
  { id: 7, tag: "M100", address: "00100", dataType: "BOOL", rw: "R", desc: "에러 플래그" },
];

const initSensors: Sensor[] = [
  { id: 1, name: "진입 감지 센서", plcAddr: "D100 (40001)", normalCond: "값 = 1", alarmCond: "값 = 0 (3초 이상)" },
  { id: 2, name: "포장 완료 센서", plcAddr: "D101 (40002)", normalCond: "카운트 증가", alarmCond: "10초간 변화 없음" },
  { id: 3, name: "온도 센서", plcAddr: "D300 (40200)", normalCond: "20~40°C", alarmCond: "> 50°C" },
  { id: 4, name: "QR 리더 상태", plcAddr: "M100 (00100)", normalCond: "값 = 0", alarmCond: "값 = 1 (리더 오류)" },
  { id: 5, name: "봉투 잔량 센서", plcAddr: "D400 (40300)", normalCond: "> 50", alarmCond: "< 10 (잔량 부족)" },
];

const initCommands: Command[] = [
  { id: 1, name: "시작", code: "CMD_START", tag: "D201", value: "1", permission: "생산관리자" },
  { id: 2, name: "정지", code: "CMD_STOP", tag: "D202", value: "1", permission: "생산관리자" },
  { id: 3, name: "리셋", code: "CMD_RESET", tag: "D203", value: "1", permission: "최고관리자" },
  { id: 4, name: "라벨 출력", code: "CMD_PRINT", tag: "D210", value: "1", permission: "현장작업자" },
  { id: 5, name: "비상 정지", code: "CMD_ESTOP", tag: "D299", value: "1", permission: "최고관리자" },
];

const initAlarms: Alarm[] = [
  { id: 1, name: "온도 이상", condition: "온도 > 50°C", target: "생산관리자", stop: true, retry: false },
  { id: 2, name: "QR 리더 오류", condition: "M100 = 1", target: "현장작업자, 생산관리자", stop: true, retry: true },
  { id: 3, name: "봉투 잔량 부족", condition: "잔량 < 10", target: "현장작업자", stop: false, retry: false },
  { id: 4, name: "통신 끊김", condition: "30초 무응답", target: "최고관리자", stop: true, retry: true },
  { id: 5, name: "포장 지연", condition: "10초간 센서 변화 없음", target: "현장작업자", stop: false, retry: true },
];

/* ── Generic CRUD Dialog helper ── */
function useCrudState<T extends { id: number }>(initial: T[]) {
  const [items, setItems] = useState<T[]>(initial);
  const [editItem, setEditItem] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openAdd = (template: T) => { setEditItem({ ...template, id: Date.now() }); setDialogOpen(true); };
  const openEdit = (item: T) => { setEditItem({ ...item }); setDialogOpen(true); };
  const save = () => {
    if (!editItem) return;
    setItems(prev => prev.some(i => i.id === editItem.id) ? prev.map(i => i.id === editItem.id ? editItem : i) : [...prev, editItem]);
    setDialogOpen(false);
    setEditItem(null);
  };
  const remove = (id: number) => setItems(prev => prev.filter(i => i.id !== id));
  const updateField = (field: keyof T, value: T[keyof T]) => setEditItem(prev => prev ? { ...prev, [field]: value } : null);

  return { items, editItem, dialogOpen, setDialogOpen, openAdd, openEdit, save, remove, updateField };
}

export default function SystemSettings() {
  const { t, lang } = useLang();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "general");
  useEffect(() => { const t = searchParams.get("tab"); if (t) setActiveTab(t); }, [searchParams]);
  const { toast } = useToast();
  const isKo = lang === "ko";

  const eq = useCrudState<Equipment>(initEquipment);
  const plc = useCrudState<PlcTag>(initPlcTags);
  const sen = useCrudState<Sensor>(initSensors);
  const cmd = useCrudState<Command>(initCommands);
  const alm = useCrudState<Alarm>(initAlarms);

  const confirmDelete = (name: string, onConfirm: () => void) => {
    if (window.confirm(isKo ? `"${name}" 을(를) 삭제하시겠습니까?` : `确定删除 "${name}" 吗？`)) {
      onConfirm();
      toast({ title: isKo ? "삭제됨" : "已删除" });
    }
  };

  const handleSave = (saveFn: () => void) => {
    saveFn();
    toast({ title: isKo ? "저장됨" : "已保存" });
  };

  const generalGroups = [
    { icon: Users, label: t("settings.userMgmt"), desc: isKo ? "사용자 승인, 역할 및 권한 관리" : "用户审批、角色及权限管理", tab: "users" },
    { icon: Server, label: t("settings.equipment"), desc: isKo ? "장비 정보, PLC IP, 프로토콜 설정" : "设备信息、PLC IP、协议设置", tab: "equipment" },
    { icon: Cpu, label: t("settings.plcTags"), desc: isKo ? "PLC 태그 주소, 데이터 타입 맵핑" : "PLC标签地址、数据类型映射", tab: "plcTags" },
    { icon: Radio, label: t("settings.sensors"), desc: isKo ? "센서 신호 정의, 정상/알람 조건 설정" : "传感器信号定义、正常/报警条件设置", tab: "sensors" },
    { icon: Play, label: t("settings.commands"), desc: isKo ? "장비 제어 명령 및 권한 설정" : "设备控制命令及权限设置", tab: "commands" },
    { icon: AlertTriangle, label: t("settings.alarms"), desc: isKo ? "알람 조건, 알림 대상, 라인 정지 규칙" : "报警条件、通知对象、停线规则", tab: "alarms" },
    { icon: ShieldCheck, label: t("settings.inspection"), desc: isKo ? "검수 기준 및 주문별 예외 기준 관리" : "检验标准及订单例外标准管理", tab: "inspection" },
    { icon: Webhook, label: t("settings.webhook"), desc: isKo ? "수신 웹훅 로그 확인 및 관리" : "接收Webhook日志查看及管理", tab: "webhook" },
    { icon: Truck, label: isKo ? "택배사 연동" : "快递对接", desc: isKo ? "4PX, YunExpress 등 택배사 API 설정" : "4PX、云途等快递公司API设置", tab: "courier" },
    { icon: ArrowUpRight, label: isKo ? "TWINMETA 회신" : "TWINMETA回调", desc: isKo ? "TWINMETA 사이트 콜백 URL 및 자동 전송 설정" : "TWINMETA站点回调URL及自动发送设置", tab: "callback" },
  ];

  const tabItems = [
    { value: "general", icon: Cog, label: t("settings.general") },
    { value: "users", icon: Users, label: t("settings.userMgmt") },
    { value: "equipment", icon: Server, label: t("settings.equipment") },
    { value: "plcTags", icon: Cpu, label: t("settings.plcTags") },
    { value: "sensors", icon: Radio, label: t("settings.sensors") },
    { value: "commands", icon: Play, label: t("settings.commands") },
    { value: "alarms", icon: AlertTriangle, label: t("settings.alarms") },
    { value: "inspection", icon: ShieldCheck, label: t("settings.inspection") },
    { value: "webhook", icon: Webhook, label: t("settings.webhook") },
    { value: "courier", icon: Truck, label: isKo ? "택배사 연동" : "快递对接" },
    { value: "callback", icon: ArrowUpRight, label: isKo ? "TWINMETA 회신" : "TWINMETA回调" },
  ];

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.desc")} />
      <div className="p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 md:grid-cols-11 mb-6 h-auto">
            {tabItems.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex items-center gap-1.5 text-xs py-2">
                <tab.icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* General */}
          <TabsContent value="general">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {generalGroups.map((g, i) => (
                <div key={i} onClick={() => setActiveTab(g.tab)} className="kpi-card section-enter cursor-pointer hover:border-primary/30 flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="p-3 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                    <g.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">{g.label}</p>
                    <p className="text-sm text-muted-foreground">{g.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="users"><div className="section-enter"><UserManagement /></div></TabsContent>

          {/* Equipment */}
          <TabsContent value="equipment">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.equipment")}</h3>
                <Button size="sm" className="gap-1.5" onClick={() => eq.openAdd({ id: 0, name: "", code: "", line: "LINE-1", plcIp: "", protocol: "Modbus TCP", connected: false })}>
                  <Plus className="w-4 h-4" />{t("settings.add")}
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.eq.name")}</TableHead>
                      <TableHead>{t("settings.eq.code")}</TableHead>
                      <TableHead>{t("settings.eq.line")}</TableHead>
                      <TableHead>{t("settings.eq.plcIp")}</TableHead>
                      <TableHead>{t("settings.eq.protocol")}</TableHead>
                      <TableHead>{t("settings.eq.gwStatus")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eq.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell><Badge variant="outline">{item.code}</Badge></TableCell>
                        <TableCell>{item.line}</TableCell>
                        <TableCell className="font-mono text-xs">{item.plcIp}</TableCell>
                        <TableCell><Badge variant="secondary">{item.protocol}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {item.connected
                              ? <><Wifi className="w-4 h-4 text-emerald-500" /><span className="text-xs text-emerald-600">{t("settings.eq.connected")}</span></>
                              : <><WifiOff className="w-4 h-4 text-destructive" /><span className="text-xs text-destructive">{t("settings.eq.disconnected")}</span></>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => eq.openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(item.name, () => eq.remove(item.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={eq.dialogOpen} onOpenChange={eq.setDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isKo ? "장비 설정" : "设备设置"}</DialogTitle></DialogHeader>
                {eq.editItem && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="col-span-2 space-y-1.5"><Label>{isKo ? "장비명" : "设备名称"}</Label><Input value={eq.editItem.name} onChange={e => eq.updateField("name", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "코드" : "代码"}</Label><Input value={eq.editItem.code} onChange={e => eq.updateField("code", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "라인" : "生产线"}</Label><Input value={eq.editItem.line} onChange={e => eq.updateField("line", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>PLC IP</Label><Input value={eq.editItem.plcIp} onChange={e => eq.updateField("plcIp", e.target.value)} /></div>
                    <div className="space-y-1.5">
                      <Label>{isKo ? "프로토콜" : "协议"}</Label>
                      <Select value={eq.editItem.protocol} onValueChange={v => eq.updateField("protocol", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="Modbus TCP">Modbus TCP</SelectItem><SelectItem value="OPC-UA">OPC-UA</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => eq.setDialogOpen(false)}>{isKo ? "취소" : "取消"}</Button>
                      <Button onClick={() => handleSave(eq.save)}>{isKo ? "저장" : "保存"}</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* PLC Tags */}
          <TabsContent value="plcTags">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.plcTags")}</h3>
                <Button size="sm" className="gap-1.5" onClick={() => plc.openAdd({ id: 0, tag: "", address: "", dataType: "INT16", rw: "R", desc: "" })}>
                  <Plus className="w-4 h-4" />{t("settings.add")}
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.plc.tagName")}</TableHead>
                      <TableHead>{t("settings.plc.address")}</TableHead>
                      <TableHead>{t("settings.plc.dataType")}</TableHead>
                      <TableHead>{t("settings.plc.rw")}</TableHead>
                      <TableHead>{t("settings.plc.desc")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plc.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs font-medium">{item.tag}</TableCell>
                        <TableCell className="font-mono text-xs">{item.address}</TableCell>
                        <TableCell><Badge variant="outline">{item.dataType}</Badge></TableCell>
                        <TableCell><Badge variant={item.rw.includes("W") ? "default" : "secondary"} className="text-xs">{item.rw}</Badge></TableCell>
                        <TableCell className="text-sm">{item.desc}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => plc.openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(item.tag, () => plc.remove(item.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={plc.dialogOpen} onOpenChange={plc.setDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isKo ? "PLC 태그 설정" : "PLC标签设置"}</DialogTitle></DialogHeader>
                {plc.editItem && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5"><Label>{isKo ? "태그명" : "标签名"}</Label><Input value={plc.editItem.tag} onChange={e => plc.updateField("tag", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "주소" : "地址"}</Label><Input value={plc.editItem.address} onChange={e => plc.updateField("address", e.target.value)} /></div>
                    <div className="space-y-1.5">
                      <Label>{isKo ? "데이터 타입" : "数据类型"}</Label>
                      <Select value={plc.editItem.dataType} onValueChange={v => plc.updateField("dataType", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{["INT16", "INT32", "FLOAT", "BOOL", "STRING"].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>{isKo ? "읽기/쓰기" : "读/写"}</Label>
                      <Select value={plc.editItem.rw} onValueChange={v => plc.updateField("rw", v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="R">{isKo ? "읽기" : "读"}</SelectItem><SelectItem value="W">{isKo ? "쓰기" : "写"}</SelectItem><SelectItem value="R/W">{isKo ? "읽기/쓰기" : "读/写"}</SelectItem></SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2 space-y-1.5"><Label>{isKo ? "설명" : "说明"}</Label><Input value={plc.editItem.desc} onChange={e => plc.updateField("desc", e.target.value)} /></div>
                    <div className="col-span-2 flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => plc.setDialogOpen(false)}>{isKo ? "취소" : "取消"}</Button>
                      <Button onClick={() => handleSave(plc.save)}>{isKo ? "저장" : "保存"}</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Sensors */}
          <TabsContent value="sensors">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.sensors")}</h3>
                <Button size="sm" className="gap-1.5" onClick={() => sen.openAdd({ id: 0, name: "", plcAddr: "", normalCond: "", alarmCond: "" })}>
                  <Plus className="w-4 h-4" />{t("settings.add")}
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.sensor.name")}</TableHead>
                      <TableHead>{t("settings.sensor.plcAddr")}</TableHead>
                      <TableHead>{t("settings.sensor.normalCond")}</TableHead>
                      <TableHead>{t("settings.sensor.alarmCond")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sen.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs">{item.plcAddr}</TableCell>
                        <TableCell><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{item.normalCond}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{item.alarmCond}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => sen.openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(item.name, () => sen.remove(item.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={sen.dialogOpen} onOpenChange={sen.setDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isKo ? "센서 설정" : "传感器设置"}</DialogTitle></DialogHeader>
                {sen.editItem && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1.5"><Label>{isKo ? "센서명" : "传感器名称"}</Label><Input value={sen.editItem.name} onChange={e => sen.updateField("name", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "PLC 주소" : "PLC地址"}</Label><Input value={sen.editItem.plcAddr} onChange={e => sen.updateField("plcAddr", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "정상 조건" : "正常条件"}</Label><Input value={sen.editItem.normalCond} onChange={e => sen.updateField("normalCond", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "알람 조건" : "报警条件"}</Label><Input value={sen.editItem.alarmCond} onChange={e => sen.updateField("alarmCond", e.target.value)} /></div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => sen.setDialogOpen(false)}>{isKo ? "취소" : "取消"}</Button>
                      <Button onClick={() => handleSave(sen.save)}>{isKo ? "저장" : "保存"}</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Commands */}
          <TabsContent value="commands">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.commands")}</h3>
                <Button size="sm" className="gap-1.5" onClick={() => cmd.openAdd({ id: 0, name: "", code: "", tag: "", value: "", permission: isKo ? "현장작업자" : "现场操作员" })}>
                  <Plus className="w-4 h-4" />{t("settings.add")}
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.cmd.name")}</TableHead>
                      <TableHead>{t("settings.cmd.code")}</TableHead>
                      <TableHead>{t("settings.cmd.tag")}</TableHead>
                      <TableHead>{t("settings.cmd.value")}</TableHead>
                      <TableHead>{t("settings.cmd.permission")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cmd.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="font-mono text-xs">{item.code}</TableCell>
                        <TableCell className="font-mono text-xs">{item.tag}</TableCell>
                        <TableCell><Badge variant="outline">{item.value}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{item.permission}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => cmd.openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(item.name, () => cmd.remove(item.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={cmd.dialogOpen} onOpenChange={cmd.setDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isKo ? "제어 명령 설정" : "控制命令设置"}</DialogTitle></DialogHeader>
                {cmd.editItem && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5"><Label>{isKo ? "명령명" : "命令名"}</Label><Input value={cmd.editItem.name} onChange={e => cmd.updateField("name", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "코드" : "代码"}</Label><Input value={cmd.editItem.code} onChange={e => cmd.updateField("code", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "PLC 태그" : "PLC标签"}</Label><Input value={cmd.editItem.tag} onChange={e => cmd.updateField("tag", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "전송 값" : "发送值"}</Label><Input value={cmd.editItem.value} onChange={e => cmd.updateField("value", e.target.value)} /></div>
                    <div className="col-span-2 space-y-1.5"><Label>{isKo ? "권한" : "权限"}</Label><Input value={cmd.editItem.permission} onChange={e => cmd.updateField("permission", e.target.value)} /></div>
                    <div className="col-span-2 flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => cmd.setDialogOpen(false)}>{isKo ? "취소" : "取消"}</Button>
                      <Button onClick={() => handleSave(cmd.save)}>{isKo ? "저장" : "保存"}</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Alarms */}
          <TabsContent value="alarms">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.alarms")}</h3>
                <Button size="sm" className="gap-1.5" onClick={() => alm.openAdd({ id: 0, name: "", condition: "", target: "", stop: false, retry: false })}>
                  <Plus className="w-4 h-4" />{t("settings.add")}
                </Button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.alarm.name")}</TableHead>
                      <TableHead>{t("settings.alarm.condition")}</TableHead>
                      <TableHead>{t("settings.alarm.target")}</TableHead>
                      <TableHead>{t("settings.alarm.stop")}</TableHead>
                      <TableHead>{t("settings.alarm.retry")}</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alm.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell className="text-sm">{item.condition}</TableCell>
                        <TableCell className="text-sm">{item.target}</TableCell>
                        <TableCell><Badge variant={item.stop ? "destructive" : "secondary"}>{item.stop ? (isKo ? "정지" : "停止") : (isKo ? "계속" : "继续")}</Badge></TableCell>
                        <TableCell><Badge variant={item.retry ? "default" : "secondary"}>{item.retry ? (isKo ? "재시도" : "重试") : (isKo ? "수동" : "手动")}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => alm.openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => confirmDelete(item.name, () => alm.remove(item.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={alm.dialogOpen} onOpenChange={alm.setDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>{isKo ? "알람 설정" : "报警设置"}</DialogTitle></DialogHeader>
                {alm.editItem && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1.5"><Label>{isKo ? "알람명" : "报警名称"}</Label><Input value={alm.editItem.name} onChange={e => alm.updateField("name", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "발생 조건" : "触发条件"}</Label><Input value={alm.editItem.condition} onChange={e => alm.updateField("condition", e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>{isKo ? "알림 대상" : "通知对象"}</Label><Input value={alm.editItem.target} onChange={e => alm.updateField("target", e.target.value)} /></div>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2"><Switch checked={alm.editItem.stop} onCheckedChange={v => alm.updateField("stop", v)} /><Label>{isKo ? "자동 정지" : "自动停止"}</Label></div>
                      <div className="flex items-center gap-2"><Switch checked={alm.editItem.retry} onCheckedChange={v => alm.updateField("retry", v)} /><Label>{isKo ? "자동 재시도" : "自动重试"}</Label></div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => alm.setDialogOpen(false)}>{isKo ? "취소" : "取消"}</Button>
                      <Button onClick={() => handleSave(alm.save)}>{isKo ? "저장" : "保存"}</Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="inspection"><InspectionStandards /></TabsContent>
          <TabsContent value="webhook"><WebhookSettings /></TabsContent>
          <TabsContent value="courier"><CourierSettings /></TabsContent>
          <TabsContent value="callback"><SiteCallbackSettings /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

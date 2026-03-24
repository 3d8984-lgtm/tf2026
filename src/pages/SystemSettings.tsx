import PageHeader from "@/components/PageHeader";
import { useLang } from "@/contexts/LangContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Bell, Shield, Cog, Server, Cpu, Radio, Play, AlertTriangle, Plus, Pencil, Trash2, Wifi, WifiOff, ShieldCheck, Webhook, Copy, Check, Truck, ArrowUpRight } from "lucide-react";
import InspectionStandards from "@/components/InspectionStandards";
import UserManagement from "@/components/UserManagement";
import WebhookSettings from "@/components/WebhookSettings";
import CourierSettings from "@/components/CourierSettings";
import SiteCallbackSettings from "@/components/SiteCallbackSettings";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/* ── mock data ── */
const mockEquipment = [
  { id: 1, name: "티셔츠 제작기 A-1", code: "A-1", line: "LINE-1", plcIp: "192.168.1.10", protocol: "Modbus TCP", connected: true },
  { id: 2, name: "티셔츠 제작기 A-2", code: "A-2", line: "LINE-1", plcIp: "192.168.1.11", protocol: "Modbus TCP", connected: true },
  { id: 3, name: "티셔츠 제작기 A-3", code: "A-3", line: "LINE-1", plcIp: "192.168.1.12", protocol: "OPC-UA", connected: false },
  { id: 4, name: "카드 포장기 B-1", code: "B-1", line: "LINE-2", plcIp: "192.168.1.20", protocol: "Modbus TCP", connected: true },
  { id: 5, name: "티셔츠+카드 포장기 B-2", code: "B-2", line: "LINE-2", plcIp: "192.168.1.21", protocol: "OPC-UA", connected: true },
  { id: 6, name: "중량검사기 B-3", code: "B-3", line: "LINE-3", plcIp: "192.168.1.25", protocol: "Modbus TCP", connected: true },
  { id: 7, name: "택배 포장기 B-4", code: "B-4", line: "LINE-3", plcIp: "192.168.1.30", protocol: "Modbus TCP", connected: true },
  { id: 8, name: "송장 부착기 B-5", code: "B-5", line: "LINE-3", plcIp: "192.168.1.31", protocol: "OPC-UA", connected: false },
];

const mockPlcTags = [
  { id: 1, tag: "D100", address: "40001", dataType: "INT16", rw: "R", desc: "현재 속도" },
  { id: 2, tag: "D101", address: "40002", dataType: "INT16", rw: "R", desc: "누적 카운트" },
  { id: 3, tag: "D200", address: "40100", dataType: "BOOL", rw: "R/W", desc: "운전 상태" },
  { id: 4, tag: "D201", address: "40101", dataType: "BOOL", rw: "W", desc: "시작 명령" },
  { id: 5, tag: "D202", address: "40102", dataType: "BOOL", rw: "W", desc: "정지 명령" },
  { id: 6, tag: "D300", address: "40200", dataType: "FLOAT", rw: "R", desc: "온도 센서" },
  { id: 7, tag: "M100", address: "00100", dataType: "BOOL", rw: "R", desc: "에러 플래그" },
];

const mockSensors = [
  { id: 1, name: "진입 감지 센서", plcAddr: "D100 (40001)", normalCond: "값 = 1", alarmCond: "값 = 0 (3초 이상)" },
  { id: 2, name: "포장 완료 센서", plcAddr: "D101 (40002)", normalCond: "카운트 증가", alarmCond: "10초간 변화 없음" },
  { id: 3, name: "온도 센서", plcAddr: "D300 (40200)", normalCond: "20~40°C", alarmCond: "> 50°C" },
  { id: 4, name: "QR 리더 상태", plcAddr: "M100 (00100)", normalCond: "값 = 0", alarmCond: "값 = 1 (리더 오류)" },
  { id: 5, name: "봉투 잔량 센서", plcAddr: "D400 (40300)", normalCond: "> 50", alarmCond: "< 10 (잔량 부족)" },
];

const mockCommands = [
  { id: 1, name: "시작", code: "CMD_START", tag: "D201", value: "1", permission: "생산관리자" },
  { id: 2, name: "정지", code: "CMD_STOP", tag: "D202", value: "1", permission: "생산관리자" },
  { id: 3, name: "리셋", code: "CMD_RESET", tag: "D203", value: "1", permission: "최고관리자" },
  { id: 4, name: "라벨 출력", code: "CMD_PRINT", tag: "D210", value: "1", permission: "현장작업자" },
  { id: 5, name: "비상 정지", code: "CMD_ESTOP", tag: "D299", value: "1", permission: "최고관리자" },
];

const mockAlarms = [
  { id: 1, name: "온도 이상", condition: "온도 > 50°C", target: "생산관리자", stop: true, retry: false },
  { id: 2, name: "QR 리더 오류", condition: "M100 = 1", target: "현장작업자, 생산관리자", stop: true, retry: true },
  { id: 3, name: "봉투 잔량 부족", condition: "잔량 < 10", target: "현장작업자", stop: false, retry: false },
  { id: 4, name: "통신 끊김", condition: "30초 무응답", target: "최고관리자", stop: true, retry: true },
  { id: 5, name: "포장 지연", condition: "10초간 센서 변화 없음", target: "현장작업자", stop: false, retry: true },
];

/* ── Chinese mock variants ── */
const mockEquipmentZh = mockEquipment.map(e => ({
  ...e,
  name: e.name
    .replace("티셔츠 제작기", "T恤制作机")
    .replace("카드 포장기", "卡片包装机")
    .replace("티셔츠+카드 포장기", "T恤+卡片包装机")
    .replace("중량검사기", "重量检测机")
    .replace("택배 포장기", "快递包装机")
    .replace("송장 부착기", "运单贴附机"),
}));

const mockPlcTagsZh = mockPlcTags.map(t => ({
  ...t,
  desc: ({ "현재 속도": "当前速度", "누적 카운트": "累计计数", "운전 상태": "运行状态", "시작 명령": "启动命令", "정지 명령": "停止命令", "온도 센서": "温度传感器", "에러 플래그": "异常标志" } as Record<string, string>)[t.desc] ?? t.desc,
  rw: t.rw.replace("R/W", "读/写").replace(/^R$/, "读").replace(/^W$/, "写"),
}));

const mockSensorsZh = mockSensors.map(s => ({
  ...s,
  name: ({ "진입 감지 센서": "进入检测传感器", "포장 완료 센서": "包装完成传感器", "온도 센서": "温度传感器", "QR 리더 상태": "QR读取器状态", "봉투 잔량 센서": "袋余量传感器" } as Record<string, string>)[s.name] ?? s.name,
  normalCond: s.normalCond.replace("값", "值").replace("카운트 증가", "计数增加"),
  alarmCond: s.alarmCond.replace("값", "值").replace("3초 이상", "3秒以上").replace("10초간 변화 없음", "10秒无变化").replace("잔량 부족", "余量不足"),
}));

const mockCommandsZh = mockCommands.map(c => ({
  ...c,
  name: ({ "시작": "启动", "정지": "停止", "리셋": "重置", "라벨 출력": "标签打印", "비상 정지": "紧急停止" } as Record<string, string>)[c.name] ?? c.name,
  permission: ({ "생산관리자": "生产管理员", "최고관리자": "超级管理员", "현장작업자": "现场操作员" } as Record<string, string>)[c.permission] ?? c.permission,
}));

const mockAlarmsZh = mockAlarms.map(a => ({
  ...a,
  name: ({ "온도 이상": "温度异常", "QR 리더 오류": "QR读取异常", "봉투 잔량 부족": "袋余量不足", "통신 끊김": "通信中断", "포장 지연": "包装延迟" } as Record<string, string>)[a.name] ?? a.name,
  condition: a.condition.replace("온도", "温度").replace("잔량", "余量").replace("초 무응답", "秒无响应").replace("초간 센서 변화 없음", "秒传感器无变化"),
  target: a.target.replace("생산관리자", "生产管理员").replace("최고관리자", "超级管理员").replace("현장작업자", "现场操作员"),
}));

export default function SystemSettings() {
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState("general");

  const isKo = lang === "ko";

  const equipment = isKo ? mockEquipment : mockEquipmentZh;
  const plcTags = isKo ? mockPlcTags : mockPlcTagsZh;
  const sensors = isKo ? mockSensors : mockSensorsZh;
  const commands = isKo ? mockCommands : mockCommandsZh;
  const alarms = isKo ? mockAlarms : mockAlarmsZh;

  const generalGroups = [
    { icon: Users, label: t("settings.userMgmt"), desc: t("settings.userMgmtDesc") },
    { icon: Shield, label: t("settings.permissions"), desc: t("settings.permissionsDesc") },
    { icon: Bell, label: t("settings.notifications"), desc: t("settings.notificationsDesc") },
    { icon: Cog, label: t("settings.system"), desc: t("settings.systemDesc") },
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
    { value: "callback", icon: ArrowUpRight, label: isKo ? "A사이트 회신" : "A站点回调" },
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
            <div className="grid md:grid-cols-2 gap-4">
              {generalGroups.map((g, i) => (
                <div key={i} className="kpi-card section-enter cursor-pointer hover:border-primary/30 flex items-center gap-4" style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="p-3 rounded-lg" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                    <g.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{g.label}</p>
                    <p className="text-sm text-muted-foreground">{g.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* User Management */}
          <TabsContent value="users">
            <div className="section-enter">
              <UserManagement />
            </div>
          </TabsContent>

          {/* Equipment Management */}
          <TabsContent value="equipment">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.equipment")}</h3>
                <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
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
                    {equipment.map(eq => (
                      <TableRow key={eq.id}>
                        <TableCell className="font-medium">{eq.name}</TableCell>
                        <TableCell><Badge variant="outline">{eq.code}</Badge></TableCell>
                        <TableCell>{eq.line}</TableCell>
                        <TableCell className="font-mono text-xs">{eq.plcIp}</TableCell>
                        <TableCell><Badge variant="secondary">{eq.protocol}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {eq.connected
                              ? <><Wifi className="w-4 h-4 text-emerald-500" /><span className="text-xs text-emerald-600">{t("settings.eq.connected")}</span></>
                              : <><WifiOff className="w-4 h-4 text-destructive" /><span className="text-xs text-destructive">{t("settings.eq.disconnected")}</span></>
                            }
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* PLC Tags */}
          <TabsContent value="plcTags">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.plcTags")}</h3>
                <div className="flex gap-2">
                  <Select defaultValue="all">
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("settings.plc.allMachines")}</SelectItem>
                      <SelectItem value="A-1">A-1</SelectItem>
                      <SelectItem value="B-1">B-1</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
                </div>
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
                    {plcTags.map(tag => (
                      <TableRow key={tag.id}>
                        <TableCell className="font-mono text-xs font-medium">{tag.tag}</TableCell>
                        <TableCell className="font-mono text-xs">{tag.address}</TableCell>
                        <TableCell><Badge variant="outline">{tag.dataType}</Badge></TableCell>
                        <TableCell>
                          <Badge variant={tag.rw.includes("W") || tag.rw.includes("写") ? "default" : "secondary"} className="text-xs">
                            {tag.rw}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{tag.desc}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* Sensors / Signal Map */}
          <TabsContent value="sensors">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.sensors")}</h3>
                <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
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
                    {sensors.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.plcAddr}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{s.normalCond}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">{s.alarmCond}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* Commands */}
          <TabsContent value="commands">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.commands")}</h3>
                <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
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
                    {commands.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="font-mono text-xs">{c.code}</TableCell>
                        <TableCell className="font-mono text-xs">{c.tag}</TableCell>
                        <TableCell><Badge variant="outline">{c.value}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{c.permission}</Badge></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* Alarms */}
          <TabsContent value="alarms">
            <div className="section-enter">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{t("settings.alarms")}</h3>
                <Button size="sm" className="gap-1.5"><Plus className="w-4 h-4" />{t("settings.add")}</Button>
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
                    {alarms.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-sm">{a.condition}</TableCell>
                        <TableCell className="text-sm">{a.target}</TableCell>
                        <TableCell>
                          <Badge variant={a.stop ? "destructive" : "secondary"}>
                            {a.stop ? (isKo ? "정지" : "停止") : (isKo ? "계속" : "继续")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={a.retry ? "default" : "secondary"}>
                            {a.retry ? (isKo ? "재시도" : "重试") : (isKo ? "수동" : "手动")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          {/* Inspection Standards */}
          <TabsContent value="inspection">
            <InspectionStandards />
          </TabsContent>

          {/* Webhook */}
          <TabsContent value="webhook">
            <WebhookSettings />
          </TabsContent>

          {/* Courier Integration */}
          <TabsContent value="courier">
            <CourierSettings />
          </TabsContent>

          {/* Site A Callback */}
          <TabsContent value="callback">
            <SiteCallbackSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

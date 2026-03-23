import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Search, FileBarChart, Calendar as CalendarIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ko, zhCN } from "date-fns/locale";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer } from "recharts";

type PeriodType = "daily" | "weekly" | "monthly" | "yearly" | "custom";

function PeriodSelector({ period, setPeriod, dateRange, setDateRange, lang }: {
  period: PeriodType;
  setPeriod: (p: PeriodType) => void;
  dateRange: { from: Date; to: Date };
  setDateRange: (r: { from: Date; to: Date }) => void;
  lang: string;
}) {
  const locale = lang === "zh" ? zhCN : ko;
  const labels: Record<PeriodType, string> = lang === "zh"
    ? { daily: "日", weekly: "周", monthly: "月", yearly: "年", custom: "自定义" }
    : { daily: "일별", weekly: "주간별", monthly: "월별", yearly: "년도별", custom: "기간별" };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(labels) as PeriodType[]).map((p) => (
        <Button
          key={p}
          size="sm"
          variant={period === p ? "default" : "outline"}
          onClick={() => setPeriod(p)}
          className="text-xs"
        >
          {labels[p]}
        </Button>
      ))}
      {period === "custom" && (
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs gap-1">
                <CalendarIcon className="w-3 h-3" />
                {format(dateRange.from, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.from}
                onSelect={(d) => d && setDateRange({ ...dateRange, from: d })}
                locale={locale}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          <span className="text-xs text-muted-foreground">~</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs gap-1">
                <CalendarIcon className="w-3 h-3" />
                {format(dateRange.to, "yyyy-MM-dd")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.to}
                onSelect={(d) => d && setDateRange({ ...dateRange, to: d })}
                locale={locale}
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      )}
      {period === "daily" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs gap-1">
              <CalendarIcon className="w-3 h-3" />
              {format(dateRange.from, "yyyy-MM-dd")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateRange.from}
              onSelect={(d) => d && setDateRange({ from: d, to: d })}
              locale={locale}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// Demo data generators
const dailyProdData = [
  { date: "03-17", tshirt: 320, set: 280, ship: 250 },
  { date: "03-18", tshirt: 350, set: 310, ship: 290 },
  { date: "03-19", tshirt: 290, set: 260, ship: 240 },
  { date: "03-20", tshirt: 380, set: 340, ship: 310 },
  { date: "03-21", tshirt: 410, set: 370, ship: 350 },
  { date: "03-22", tshirt: 360, set: 330, ship: 300 },
  { date: "03-23", tshirt: 400, set: 360, ship: 340 },
];

const machineUptimeData = [
  { name: "A-1", uptime: 95, downtime: 5 },
  { name: "A-2", uptime: 88, downtime: 12 },
  { name: "A-3", uptime: 92, downtime: 8 },
  { name: "B-1", uptime: 97, downtime: 3 },
  { name: "B-2", uptime: 90, downtime: 10 },
  { name: "B-3", uptime: 85, downtime: 15 },
  { name: "B-4", uptime: 93, downtime: 7 },
];

const defectRateData = [
  { date: "03-17", qrMismatch: 2, attachFail: 1, packFail: 0, commError: 1 },
  { date: "03-18", qrMismatch: 3, attachFail: 0, packFail: 1, commError: 0 },
  { date: "03-19", qrMismatch: 1, attachFail: 2, packFail: 0, commError: 0 },
  { date: "03-20", qrMismatch: 0, attachFail: 1, packFail: 1, commError: 2 },
  { date: "03-21", qrMismatch: 2, attachFail: 0, packFail: 0, commError: 0 },
  { date: "03-22", qrMismatch: 1, attachFail: 1, packFail: 2, commError: 1 },
  { date: "03-23", qrMismatch: 0, attachFail: 0, packFail: 1, commError: 0 },
];

const workerData = [
  { name: "김작업", tshirt: 120, card: 95, set: 88, ship: 80 },
  { name: "이포장", tshirt: 105, card: 110, set: 100, ship: 95 },
  { name: "박출고", tshirt: 90, card: 85, set: 92, ship: 110 },
  { name: "최검수", tshirt: 115, card: 100, set: 95, ship: 85 },
];

const prodChartConfig: ChartConfig = {
  tshirt: { label: "티셔츠 제작", color: "hsl(var(--primary))" },
  set: { label: "세트 포장", color: "hsl(142 71% 45%)" },
  ship: { label: "출고", color: "hsl(38 92% 50%)" },
};

const uptimeChartConfig: ChartConfig = {
  uptime: { label: "가동률", color: "hsl(var(--primary))" },
  downtime: { label: "비가동", color: "hsl(var(--destructive))" },
};

const defectChartConfig: ChartConfig = {
  qrMismatch: { label: "QR 불일치", color: "hsl(var(--destructive))" },
  attachFail: { label: "부착 불량", color: "hsl(38 92% 50%)" },
  packFail: { label: "포장 불량", color: "hsl(262 83% 58%)" },
  commError: { label: "통신 오류", color: "hsl(var(--muted-foreground))" },
};

const workerChartConfig: ChartConfig = {
  tshirt: { label: "티셔츠", color: "hsl(var(--primary))" },
  card: { label: "카드", color: "hsl(38 92% 50%)" },
  set: { label: "세트", color: "hsl(142 71% 45%)" },
  ship: { label: "출고", color: "hsl(262 83% 58%)" },
};

function ProductionReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("daily");
  const [dateRange, setDateRange] = useState({ from: new Date(), to: new Date() });
  const isKo = lang !== "zh";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "생산 실적" : "生产实绩"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: isKo ? "티셔츠 제작" : "T恤制作", value: "2,510", change: "+5.2%", type: "positive" as const },
          { label: isKo ? "세트 포장" : "套装包装", value: "2,250", change: "+3.1%", type: "positive" as const },
          { label: isKo ? "출고 완료" : "出库完成", value: "2,080", change: "-1.2%", type: "negative" as const },
        ].map((item) => (
          <div key={item.label} className="kpi-card p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-xl font-semibold mt-1 tabular-nums">{item.value}</p>
            <p className={`text-xs mt-1 flex items-center gap-1 ${item.type === "positive" ? "text-success" : "text-destructive"}`}>
              {item.type === "positive" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {item.change}
            </p>
          </div>
        ))}
      </div>

      <div className="kpi-card p-4">
        <ChartContainer config={prodChartConfig} className="h-[280px] w-full">
          <BarChart data={dailyProdData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="tshirt" fill="var(--color-tshirt)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="set" fill="var(--color-set)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="ship" fill="var(--color-ship)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="kpi-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "날짜" : "日期"}</TableHead>
              <TableHead className="text-right">{isKo ? "티셔츠 제작" : "T恤制作"}</TableHead>
              <TableHead className="text-right">{isKo ? "세트 포장" : "套装包装"}</TableHead>
              <TableHead className="text-right">{isKo ? "출고" : "出库"}</TableHead>
              <TableHead className="text-right">{isKo ? "합계" : "合计"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dailyProdData.map((row) => (
              <TableRow key={row.date}>
                <TableCell className="font-medium">{row.date}</TableCell>
                <TableCell className="text-right tabular-nums">{row.tshirt}</TableCell>
                <TableCell className="text-right tabular-nums">{row.set}</TableCell>
                <TableCell className="text-right tabular-nums">{row.ship}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{row.tshirt + row.set + row.ship}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MachineUptimeReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("daily");
  const [dateRange, setDateRange] = useState({ from: new Date(), to: new Date() });
  const isKo = lang !== "zh";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "기계별 가동률" : "设备运行率"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      <div className="kpi-card p-4">
        <ChartContainer config={uptimeChartConfig} className="h-[280px] w-full">
          <BarChart data={machineUptimeData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis dataKey="name" type="category" fontSize={12} tickLine={false} axisLine={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="uptime" fill="var(--color-uptime)" stackId="a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="downtime" fill="var(--color-downtime)" stackId="a" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="kpi-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "기계" : "设备"}</TableHead>
              <TableHead className="text-right">{isKo ? "가동률" : "运行率"}</TableHead>
              <TableHead className="text-right">{isKo ? "비가동" : "停机"}</TableHead>
              <TableHead>{isKo ? "상태" : "状态"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {machineUptimeData.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">{row.uptime}%</TableCell>
                <TableCell className="text-right tabular-nums">{row.downtime}%</TableCell>
                <TableCell>
                  <Badge variant={row.uptime >= 90 ? "default" : "destructive"} className="text-xs">
                    {row.uptime >= 90 ? (isKo ? "양호" : "良好") : (isKo ? "주의" : "注意")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DefectRateReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("daily");
  const [dateRange, setDateRange] = useState({ from: new Date(), to: new Date() });
  const isKo = lang !== "zh";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "불량률 분석" : "不良率分析"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: isKo ? "QR 불일치" : "QR不匹配", value: 9, color: "text-destructive" },
          { label: isKo ? "부착 불량" : "贴附不良", value: 5, color: "text-amber-500" },
          { label: isKo ? "포장 불량" : "包装不良", value: 5, color: "text-purple-500" },
          { label: isKo ? "통신 오류" : "通信异常", value: 4, color: "text-muted-foreground" },
        ].map((item) => (
          <div key={item.label} className="kpi-card p-3 text-center">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={`text-xl font-semibold mt-1 tabular-nums ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="kpi-card p-4">
        <ChartContainer config={defectChartConfig} className="h-[280px] w-full">
          <LineChart data={defectRateData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line type="monotone" dataKey="qrMismatch" stroke="var(--color-qrMismatch)" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="attachFail" stroke="var(--color-attachFail)" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="packFail" stroke="var(--color-packFail)" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="commError" stroke="var(--color-commError)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ChartContainer>
      </div>

      <div className="kpi-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "날짜" : "日期"}</TableHead>
              <TableHead className="text-right">{isKo ? "QR 불일치" : "QR不匹配"}</TableHead>
              <TableHead className="text-right">{isKo ? "부착 불량" : "贴附不良"}</TableHead>
              <TableHead className="text-right">{isKo ? "포장 불량" : "包装不良"}</TableHead>
              <TableHead className="text-right">{isKo ? "통신 오류" : "通信异常"}</TableHead>
              <TableHead className="text-right">{isKo ? "합계" : "合计"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {defectRateData.map((row) => (
              <TableRow key={row.date}>
                <TableCell className="font-medium">{row.date}</TableCell>
                <TableCell className="text-right tabular-nums">{row.qrMismatch}</TableCell>
                <TableCell className="text-right tabular-nums">{row.attachFail}</TableCell>
                <TableCell className="text-right tabular-nums">{row.packFail}</TableCell>
                <TableCell className="text-right tabular-nums">{row.commError}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {row.qrMismatch + row.attachFail + row.packFail + row.commError}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WorkerOutputReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("daily");
  const [dateRange, setDateRange] = useState({ from: new Date(), to: new Date() });
  const isKo = lang !== "zh";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "작업자별 처리량" : "作业员产量"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      <div className="kpi-card p-4">
        <ChartContainer config={workerChartConfig} className="h-[280px] w-full">
          <BarChart data={workerData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="tshirt" fill="var(--color-tshirt)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="card" fill="var(--color-card)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="set" fill="var(--color-set)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="ship" fill="var(--color-ship)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </div>

      <div className="kpi-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "작업자" : "作业员"}</TableHead>
              <TableHead className="text-right">{isKo ? "티셔츠" : "T恤"}</TableHead>
              <TableHead className="text-right">{isKo ? "카드" : "卡片"}</TableHead>
              <TableHead className="text-right">{isKo ? "세트" : "套装"}</TableHead>
              <TableHead className="text-right">{isKo ? "출고" : "出库"}</TableHead>
              <TableHead className="text-right">{isKo ? "합계" : "合计"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workerData.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">{row.tshirt}</TableCell>
                <TableCell className="text-right tabular-nums">{row.card}</TableCell>
                <TableCell className="text-right tabular-nums">{row.set}</TableCell>
                <TableCell className="text-right tabular-nums">{row.ship}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">
                  {row.tshirt + row.card + row.set + row.ship}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function Reports() {
  const { t, lang } = useLang();
  const isKo = lang !== "zh";

  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.desc")} />
      <div className="p-6 space-y-6">
        {/* 추적 조회 */}
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">{t("reports.trace")}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("reports.traceDesc")}</p>
          <div className="relative max-w-lg">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("reports.searchPlaceholder")} />
          </div>
        </div>

        {/* 리포트 탭 */}
        <div className="section-enter" style={{ animationDelay: "120ms" }}>
          <Tabs defaultValue="production">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1">
              <TabsTrigger value="production" className="text-xs">
                {isKo ? "생산 실적" : "生产实绩"}
              </TabsTrigger>
              <TabsTrigger value="uptime" className="text-xs">
                {isKo ? "기계별 가동률" : "设备运行率"}
              </TabsTrigger>
              <TabsTrigger value="defects" className="text-xs">
                {isKo ? "불량률 분석" : "不良率分析"}
              </TabsTrigger>
              <TabsTrigger value="workers" className="text-xs">
                {isKo ? "작업자별 처리량" : "作业员产量"}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="production">
              <ProductionReport lang={lang} />
            </TabsContent>
            <TabsContent value="uptime">
              <MachineUptimeReport lang={lang} />
            </TabsContent>
            <TabsContent value="defects">
              <DefectRateReport lang={lang} />
            </TabsContent>
            <TabsContent value="workers">
              <WorkerOutputReport lang={lang} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

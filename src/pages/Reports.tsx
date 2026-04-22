import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Search, Calendar as CalendarIcon, TrendingUp, TrendingDown } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, subDays } from "date-fns";
import { ko, zhCN } from "date-fns/locale";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from "recharts";
import { useProductionReport, useMachineReport, useDefectReport } from "@/hooks/useReportData";
import { Skeleton } from "@/components/ui/skeleton";

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
        <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)} className="text-xs">
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
              <Calendar mode="single" selected={dateRange.from} onSelect={(d) => d && setDateRange({ ...dateRange, from: d })} locale={locale} className="p-3 pointer-events-auto" />
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
              <Calendar mode="single" selected={dateRange.to} onSelect={(d) => d && setDateRange({ ...dateRange, to: d })} locale={locale} className="p-3 pointer-events-auto" />
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
            <Calendar mode="single" selected={dateRange.from} onSelect={(d) => d && setDateRange({ from: d, to: d })} locale={locale} className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="kpi-card p-8 text-center text-muted-foreground text-sm">
      {label}
    </div>
  );
}

const prodChartConfig: ChartConfig = {
  tshirt: { label: "티셔츠", color: "hsl(var(--primary))" },
  set: { label: "세트", color: "hsl(142 71% 45%)" },
  courier: { label: "출고", color: "hsl(38 92% 50%)" },
};

function ProductionReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 7), to: new Date() });
  const isKo = lang !== "zh";
  const { data, isLoading } = useProductionReport(dateRange.from, dateRange.to);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "생산 실적" : "生产实绩"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      {isLoading ? <Skeleton className="h-[280px] w-full" /> : !data?.chartData.length ? (
        <EmptyState label={isKo ? "해당 기간의 생산 데이터가 없습니다" : "该期间无生产数据"} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: isKo ? "티셔츠 제작" : "T恤制作", value: data.totals.tshirt },
              { label: isKo ? "세트 포장" : "套装包装", value: data.totals.set },
              { label: isKo ? "출고 완료" : "出库完成", value: data.totals.ship },
            ].map((item) => (
              <div key={item.label} className="kpi-card p-3">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-xl font-semibold mt-1 tabular-nums">{item.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="kpi-card p-4">
            <ChartContainer config={prodChartConfig} className="h-[280px] w-full">
              <BarChart data={data.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="tshirt" fill="var(--color-tshirt)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="set" fill="var(--color-set)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="courier" fill="var(--color-courier)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </div>

          <div className="kpi-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isKo ? "날짜" : "日期"}</TableHead>
                  <TableHead className="text-right">{isKo ? "티셔츠" : "T恤"}</TableHead>
                  <TableHead className="text-right">{isKo ? "세트" : "套装"}</TableHead>
                  <TableHead className="text-right">{isKo ? "출고" : "出库"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.chartData.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.tshirt}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.set}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.courier}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

const uptimeChartConfig: ChartConfig = {
  uptime: { label: "가동률", color: "hsl(var(--primary))" },
  downtime: { label: "비가동", color: "hsl(var(--destructive))" },
};

function MachineUptimeReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 7), to: new Date() });
  const isKo = lang !== "zh";
  const { data, isLoading } = useMachineReport(dateRange.from, dateRange.to);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "기계별 가동률" : "设备运行率"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      {isLoading ? <Skeleton className="h-[280px] w-full" /> : !data?.length ? (
        <EmptyState label={isKo ? "해당 기간의 기계 데이터가 없습니다" : "该期间无设备数据"} />
      ) : (
        <>
          <div className="kpi-card p-4">
            <ChartContainer config={uptimeChartConfig} className="h-[280px] w-full">
              <BarChart data={data} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} fontSize={12} tickLine={false} axisLine={false} />
                <YAxis dataKey="name" type="category" fontSize={12} tickLine={false} axisLine={false} width={40} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="uptime" fill="var(--color-uptime)" stackId="a" />
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
                {data.map((row) => (
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
        </>
      )}
    </div>
  );
}

const defectChartConfig: ChartConfig = {
  qrMismatch: { label: "QR 불일치", color: "hsl(var(--destructive))" },
  weightFail: { label: "중량 불량", color: "hsl(38 92% 50%)" },
};

function DefectRateReport({ lang }: { lang: string }) {
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 7), to: new Date() });
  const isKo = lang !== "zh";
  const { data, isLoading } = useDefectReport(dateRange.from, dateRange.to);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">{isKo ? "불량률 분석" : "不良率分析"}</h3>
        <PeriodSelector period={period} setPeriod={setPeriod} dateRange={dateRange} setDateRange={setDateRange} lang={lang} />
      </div>

      {isLoading ? <Skeleton className="h-[280px] w-full" /> : !data?.chartData.length ? (
        <EmptyState label={isKo ? "해당 기간의 불량 데이터가 없습니다" : "该期间无不良数据"} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="kpi-card p-3 text-center">
              <p className="text-xs text-muted-foreground">{isKo ? "QR 불일치" : "QR不匹配"}</p>
              <p className="text-xl font-semibold mt-1 tabular-nums text-destructive">{data.totals.qrMismatch}</p>
            </div>
            <div className="kpi-card p-3 text-center">
              <p className="text-xs text-muted-foreground">{isKo ? "중량 불량" : "重量不良"}</p>
              <p className="text-xl font-semibold mt-1 tabular-nums text-amber-500">{data.totals.weightFail}</p>
            </div>
          </div>

          <div className="kpi-card p-4">
            <ChartContainer config={defectChartConfig} className="h-[280px] w-full">
              <LineChart data={data.chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="qrMismatch" stroke="var(--color-qrMismatch)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="weightFail" stroke="var(--color-weightFail)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
          </div>

          <div className="kpi-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isKo ? "날짜" : "日期"}</TableHead>
                  <TableHead className="text-right">{isKo ? "QR 불일치" : "QR不匹配"}</TableHead>
                  <TableHead className="text-right">{isKo ? "중량 불량" : "重量不良"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.chartData.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium">{row.date}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.qrMismatch}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.weightFail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function WorkerOutputReport({ lang }: { lang: string }) {
  const isKo = lang !== "zh";
  return (
    <EmptyState label={isKo ? "작업자별 처리량 데이터가 없습니다. 작업자 데이터가 연동되면 자동으로 표시됩니다." : "无作业员产量数据。连接作业员数据后将自动显示。"} />
  );
}

export default function Reports() {
  const { t, lang } = useLang();
  const isKo = lang !== "zh";

  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.desc")} />
      <div className="p-6 space-y-6">
        <div className="kpi-card section-enter">
          <h3 className="text-sm font-medium mb-3">{t("reports.trace")}</h3>
          <p className="text-xs text-muted-foreground mb-3">{t("reports.traceDesc")}</p>
          <div className="relative max-w-lg">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="w-full pl-9 pr-3 py-2 rounded-md border bg-background text-sm" placeholder={t("reports.searchPlaceholder")} />
          </div>
        </div>

        <div className="section-enter" style={{ animationDelay: "120ms" }}>
          <Tabs defaultValue="production">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1">
              <TabsTrigger value="production" className="text-xs">{isKo ? "생산 실적" : "生产实绩"}</TabsTrigger>
              <TabsTrigger value="uptime" className="text-xs">{isKo ? "기계별 가동률" : "设备运行率"}</TabsTrigger>
              <TabsTrigger value="defects" className="text-xs">{isKo ? "불량률 분석" : "不良率分析"}</TabsTrigger>
              <TabsTrigger value="workers" className="text-xs">{isKo ? "작업자별 처리량" : "作业员产量"}</TabsTrigger>
            </TabsList>
            <TabsContent value="production"><ProductionReport lang={lang} /></TabsContent>
            <TabsContent value="uptime"><MachineUptimeReport lang={lang} /></TabsContent>
            <TabsContent value="defects"><DefectRateReport lang={lang} /></TabsContent>
            <TabsContent value="workers"><WorkerOutputReport lang={lang} /></TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

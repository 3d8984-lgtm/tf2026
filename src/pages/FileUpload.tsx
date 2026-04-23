import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileSpreadsheet, CheckCircle2, XCircle, Download, FileUp, Info, Image,
  Globe, RefreshCw, ArrowDownToLine, Clock, AlertCircle, CircleAlert, Save, Loader2, Trash2
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLang } from "@/contexts/LangContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";
import { downloadEmbeddedTemplate } from "@/lib/file-upload-template";

export default function FileUpload() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "api");
  useEffect(() => { const t = searchParams.get("tab"); if (t) setTab(t); }, [searchParams]);
  const [isDragging, setIsDragging] = useState(false);
  const [apiSyncing, setApiSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFileRef = useRef<File | null>(null);
  const [uploadResult, setUploadResult] = useState<null | {
    fileName: string;
    total: number;
    success: number;
    error: number;
    columnResults: { col: string; category: string; label: string; filled: number; empty: number; error: number }[];
  }>(null);
  const [parsedRows, setParsedRows] = useState<any[][]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const isSafeStoragePath = (path: string | null | undefined) => !!path && /^[A-Za-z0-9._/-]+$/.test(path);

  // Fetch upload history from DB
  const { data: uploadHistory = [] } = useQuery({
    queryKey: ["upload_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_history")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Column spec for file upload
  const columnSpec = [
    { col: "A", category: isKo ? "주문확인" : "订单确认", key: "work_order_no", label: isKo ? "작업지시번호" : "作业指示编号", desc: isKo ? "YYYYMMDD-N 형식의 고유 작업지시 번호" : "YYYYMMDD-N格式的唯一作业指示编号" },
    { col: "B", category: isKo ? "주문확인" : "订单确认", key: "order_no", label: isKo ? "주문번호" : "订单号", desc: isKo ? "TWINMETA 사이트에서 발급된 주문 번호" : "TWINMETA站点发放的订单号" },
    { col: "C", category: isKo ? "주문확인" : "订单确认", key: "project_deadline", label: isKo ? "납기 발송일" : "交期发货日", desc: isKo ? "주문 건의 발송 마감일 (YYYY-MM-DD)" : "订单的发货截止日期 (YYYY-MM-DD)" },
    { col: "D", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_serial", label: isKo ? "티셔츠 일련번호" : "T恤序列号", desc: isKo ? "개별 티셔츠 고유 일련번호" : "单件T恤唯一序列号" },
    { col: "E", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_type", label: isKo ? "티셔츠 종류" : "T恤种类", desc: isKo ? "티셔츠 제품 유형 구분" : "T恤产品类型区분" },
    { col: "F", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_color", label: isKo ? "티셔츠 컬러" : "T恤颜色", desc: isKo ? "티셔츠 색상 코드 또는 명칭" : "T恤颜色代码或名称" },
    { col: "G", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "tshirt_size", label: isKo ? "티셔츠 사이즈" : "T恤尺码", desc: isKo ? "티셔츠 사이즈 (S/M/L/XL 등)" : "T恤尺码 (S/M/L/XL等)" },
    { col: "H", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "silicon_qr", label: isKo ? "실리콘 마크QR값" : "硅胶标记QR值", desc: isKo ? "실리콘 마크에 인쇄된 QR 코드 값" : "硅胶标记上印刷的QR码值" },
    { col: "I", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "design_qr", label: isKo ? "디자인QR값" : "设计QR值", desc: isKo ? "디자인 식별용 QR 코드 값" : "设计识别用QR码值" },
    { col: "J", category: isKo ? "티셔츠 작업용" : "T恤作业用", key: "hologram_qr", label: isKo ? "홀로그램QR값" : "全息QR值", desc: isKo ? "홀로그램 스티커의 QR 코드 값" : "全息贴纸的QR码值" },
    { col: "K", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_serial", label: isKo ? "카드 일련번호" : "卡片序列号", desc: isKo ? "개별 카드 고유 일련번호" : "单张卡片唯一序列号" },
    { col: "L", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_grade", label: isKo ? "카드 등급" : "卡片等级", desc: isKo ? "카드 품질 등급 (S/A/B 등)" : "卡片品质等级 (S/A/B等)" },
    { col: "M", category: isKo ? "카드 포장용" : "卡片包装用", key: "card_barcode", label: isKo ? "카드 바코드값" : "卡片条码值", desc: isKo ? "카드에 인쇄된 바코드 값" : "卡片上印刷的条码值" },
    { col: "N", category: isKo ? "택배송장정보" : "快递面单信息", key: "country_code", label: isKo ? "국가기호" : "国家代码", desc: isKo ? "배송 국가 코드 (US, KR 등)" : "配送国家代码 (US, KR等)" },
    { col: "O", category: isKo ? "택배송장정보" : "快递面单信息", key: "recipient", label: isKo ? "수취인명" : "收件人", desc: isKo ? "택배 수취인(트윈커) 이름" : "快递收件人(Twinker)姓名" },
    { col: "P", category: isKo ? "택배송장정보" : "快递面单信息", key: "phone", label: isKo ? "연락처" : "联系方式", desc: isKo ? "수취인 연락처 전화번호" : "收件人联系电话" },
    { col: "Q", category: isKo ? "택배송장정보" : "快递面单信息", key: "address", label: isKo ? "주소" : "地址", desc: isKo ? "배송지 상세 주소" : "配送地址详情" },
    { col: "R", category: isKo ? "택배송장정보" : "快递面单信息", key: "zipcode", label: isKo ? "우편번호" : "邮编", desc: isKo ? "배송지 우편번호 (ZIP Code)" : "配送地邮编 (ZIP Code)" },
  ];

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return;
    }
    setSaved(false);
    currentFileRef.current = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const dataRows = rows.slice(2);
        const totalRows = dataRows.length;

        const colResults = columnSpec.map((spec, idx) => {
          let filled = 0, empty = 0;
          dataRows.forEach((row) => {
            const val = row[idx];
            if (val === undefined || val === null || String(val).trim() === "") {
              empty++;
            } else {
              filled++;
            }
          });
          return { col: spec.col, category: spec.category, label: spec.label, filled, empty, error: 0 };
        });

        setParsedRows(dataRows);
        setUploadResult({
          fileName: file.name,
          total: totalRows,
          success: totalRows,
          error: 0,
          columnResults: colResults,
        });
      } catch (err) {
        console.error("Failed to parse xlsx:", err);
      }
    };
    reader.readAsArrayBuffer(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKo]);

  const handleSaveToDb = async () => {
    if (!parsedRows.length) return;
    setSaving(true);
    try {
      // Map Excel rows to orders table
      // A(0): work_order_no → external_order_id
      // B(1): order_no → product_code
      // C(2): project_deadline → project_completed_at
      // D(3): tshirt_serial, E(4): tshirt_type, F(5): tshirt_color, G(6): tshirt_size
      // H(7): silicon_qr, I(8): design_qr, J(9): hologram_qr
      // K(10): card_serial, L(11): card_grade, M(12): card_barcode
      // N(13): country_code, O(14): recipient, P(15): phone, Q(16): address, R(17): zipcode

      // Group rows by external_order_id (work order no) since multiple rows can share the same order
      const orderMap = new Map<string, {
        external_order_id: string;
        product_code: string;
        design_code: string | null;
        quantity: number;
        recipient_name: string;
        recipient_phone: string | null;
        shipping_address: string;
        shipping_city: string | null;
        shipping_state: string | null;
        shipping_zip: string | null;
        shipping_country: string;
        project_completed_at: string | null;
        source_data: Json;
      }>();

      for (const row of parsedRows) {
        const str = (idx: number) => String(row[idx] ?? "").trim();
        const extId = str(0);
        if (!extId) continue;

        // Parse date
        let projectDate: string | null = null;
        const rawDate = row[2];
        if (rawDate) {
          if (typeof rawDate === "number") {
            const d = XLSX.SSF.parse_date_code(rawDate);
            if (d) projectDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
          } else {
            projectDate = String(rawDate).trim() || null;
          }
        }

        const itemData = {
          tshirt_serial: str(3),
          tshirt_type: str(4),
          tshirt_color: str(5),
          tshirt_size: str(6),
          silicon_qr: str(7),
          design_qr: str(8),
          hologram_qr: str(9),
          card_serial: str(10),
          card_grade: str(11),
          card_barcode: str(12),
        };

        if (orderMap.has(extId)) {
          const existing = orderMap.get(extId)!;
          existing.quantity += 1;
          // Append item to items array in source_data
          ((existing.source_data as { items: Record<string, string>[] }).items).push(itemData);
        } else {
          orderMap.set(extId, {
            external_order_id: extId,
            product_code: str(1) || extId,
            design_code: str(8) || null,
            quantity: 1,
            recipient_name: str(14) || "N/A",
            recipient_phone: str(15) || null,
            shipping_address: str(16) || "N/A",
            shipping_city: null,
            shipping_state: null,
            shipping_zip: str(17) || null,
            shipping_country: str(13) || "US",
            project_completed_at: projectDate,
            source_data: { items: [itemData] },
          });
        }
      }

      const orders = Array.from(orderMap.values());

      if (!orders.length) {
        toast({ title: isKo ? "저장할 데이터가 없습니다" : "没有可保存的数据", variant: "destructive" });
        setSaving(false);
        return;
      }

      // Upsert in batches of 50 (handles duplicate external_order_id)
      let successCount = 0;
      let errorCount = 0;
      for (let i = 0; i < orders.length; i += 50) {
        const batch = orders.slice(i, i + 50);
        const { error } = await supabase.from("orders").upsert(batch, { onConflict: "external_order_id" });
        if (error) {
          console.error("Upsert error:", error);
          errorCount += batch.length;
        } else {
          successCount += batch.length;
        }
      }

      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order_stats"] });

      // Save file to storage and record history
      const file = currentFileRef.current;
      let filePath: string | null = null;
      let fileUploadFailed = false;
      if (file) {
        const ts = Date.now();
        const ext = file.name.split(".").pop() || "xlsx";
        const storagePath = `${ts}.${ext}`;
        const { error: storageError } = await supabase.storage.from("upload-files").upload(storagePath, file);
        if (storageError) {
          console.error("Storage upload error:", storageError);
          fileUploadFailed = true;
        } else {
          filePath = storagePath;
        }
      }

      const { data: sessionData } = await supabase.auth.getUser();
      const userEmail = sessionData?.user?.email || null;
      const userId = sessionData?.user?.id || null;

      await supabase.from("upload_history").insert({
        file_name: uploadResult?.fileName || file?.name || "unknown",
        row_count: parsedRows.length,
        success_count: successCount,
        error_count: errorCount,
        user_email: userEmail,
        user_id: userId,
        file_path: filePath,
      });

      queryClient.invalidateQueries({ queryKey: ["upload_history"] });

      if (errorCount > 0) {
        toast({
          title: isKo ? `주문 ${successCount}건 저장, ${errorCount}건 오류` : `${successCount}条订单已保存, ${errorCount}条异常`,
          description: isKo ? `총 ${parsedRows.length}행 처리` : `共处理${parsedRows.length}行`,
          variant: "destructive",
        });
      } else {
        toast({
          title: isKo ? `주문 ${successCount}건 저장 완료` : `${successCount}条订单保存成功`,
          description: isKo ? `${parsedRows.length}행 → ${successCount}건 주문 등록` : `${parsedRows.length}行 → ${successCount}条订单注册`,
        });
      }
    } catch (err) {
      console.error("Save error:", err);
      toast({ title: isKo ? "저장 중 오류 발생" : "保存时发生错误", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const categoryBadges = [
    { label: isKo ? "주문확인" : "订单确认", cols: "A~C" },
    { label: isKo ? "티셔츠 작업용" : "T恤作业用", cols: "D~J" },
    { label: isKo ? "카드 포장용" : "卡片包装用", cols: "K~M" },
    { label: isKo ? "택배송장정보" : "快递面单信息", cols: "N~R" },
  ];

  const handleDownloadTemplate = () => {
    downloadEmbeddedTemplate(isKo ? "템플릿.xlsx" : "模板.xlsx");
  };

  const handleApiSync = () => {
    setApiSyncing(true);
    setTimeout(() => setApiSyncing(false), 2000);
  };

  const apiSyncHistory: { time: string; orders: number; new: number; updated: number; errors: number; deadline: string; status: string }[] = [];

  return (
    <div>
      <PageHeader
        title={isKo ? "주문 데이터 가져오기" : "订单数据导入"}
        description={isKo ? "API 연동 또는 엑셀 파일로 주문 데이터를 가져옵니다" : "通过API连接或Excel文件导入订单数据"}
      />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="api" className="gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              {isKo ? "API 연동" : "API连接"}
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1.5">
              <FileUp className="w-3.5 h-3.5" />
              {isKo ? "파일 업로드" : "文件上传"}
            </TabsTrigger>
          </TabsList>

          {/* ═══ API Tab ═══ */}
          <TabsContent value="api" className="space-y-6">
            {/* API connection status */}
            <div className="kpi-card section-enter">
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">
                      {isKo ? "TWINMETA 사이트 API 연동" : "TWINMETA站点 API连接"}
                    </h3>
                    <span className="status-badge status-running">
                      {isKo ? "연결됨" : "已连接"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    {isKo
                      ? "Webhook을 통해 TWINMETA 사이트에서 실시간으로 주문 데이터를 수신합니다. 수동 동기화 버튼으로 누락 건을 확인할 수 있습니다."
                      : "通过Webhook从TWINMETA站点实时接收订单数据。可通过手动同步按钮检查遗漏订单。"}
                  </p>
                  <div className="flex items-center gap-3">
                    <Button size="sm" className="gap-1.5" onClick={handleApiSync} disabled={apiSyncing}>
                      <RefreshCw className={`w-3.5 h-3.5 ${apiSyncing ? "animate-spin" : ""}`} />
                      {apiSyncing
                        ? (isKo ? "동기화 중..." : "同步中...")
                        : (isKo ? "수동 동기화" : "手动同步")}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {isKo ? "마지막 동기화: -" : "最后同步: -"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* API sync stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: isKo ? "오늘 수신" : "今日接收", value: "0", icon: ArrowDownToLine, color: "text-primary" },
                { label: isKo ? "신규 등록" : "新增注册", value: "0", icon: CheckCircle2, color: "text-emerald-500" },
                { label: isKo ? "업데이트" : "已更新", value: "0", icon: RefreshCw, color: "text-blue-500" },
                { label: isKo ? "오류" : "异常", value: "0", icon: AlertCircle, color: "text-muted-foreground" },
              ].map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="kpi-card section-enter text-center" style={{ animationDelay: `${i * 60}ms` }}>
                    <Icon className={`w-5 h-5 mx-auto mb-2 ${s.color}`} />
                    <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                  </div>
                );
              })}
            </div>

            {/* API sync history */}
            <div className="kpi-card section-enter" style={{ animationDelay: "80ms" }}>
              <h3 className="text-sm font-medium mb-4">
                {isKo ? "동기화 이력" : "同步记录"}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "시간" : "时间"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "총 건수" : "总数"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "신규" : "新增"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "업데이트" : "更新"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "오류" : "异常"}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{isKo ? "납기 발송일" : "交期发货日"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "결과" : "结果"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiSyncHistory.map((h, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {h.time}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{h.orders}</td>
                        <td className="py-2.5 text-right tabular-nums text-emerald-600">{h.new}</td>
                        <td className="py-2.5 text-right tabular-nums text-blue-600">{h.updated}</td>
                        <td className="py-2.5 text-right tabular-nums">
                          {h.errors > 0 ? <span className="text-destructive">{h.errors}</span> : "-"}
                        </td>
                        <td className="py-2.5 text-muted-foreground">{h.deadline}</td>
                        <td className="py-2.5 text-center">
                          {h.status === "success"
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                            : <AlertCircle className="w-4 h-4 text-warning mx-auto" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══ File Upload Tab ═══ */}
          <TabsContent value="file" className="space-y-6">
            {/* Column guide */}
            <div className="kpi-card section-enter flex items-start gap-4">
              <div className="p-2.5 rounded-lg shrink-0" style={{ background: "hsl(var(--primary) / 0.08)" }}>
                <Info className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold mb-1">
                  {isKo ? "엑셀 템플릿 구조 안내" : "Excel模板结构说明"}
                </h3>
                <p className="text-xs text-muted-foreground mb-1">
                  {isKo
                    ? "시트1: 1행(카테고리) / 2행(항목명) / 3행부터 데이터 입력"
                    : "工作表1: 第1行(类别) / 第2行(字段名) / 第3行起输入数据"}
                </p>
                <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                  <Image className="w-3.5 h-3.5" />
                  {isKo
                    ? "시트2: A열(로고 이미지 목록) / B열(로고 이미지 파일)"
                    : "工作表2: A列(Logo图片列表) / B列(Logo图片文件)"}
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {categoryBadges.map((g) => (
                    <span key={g.cols} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-border bg-muted/30 text-foreground">
                      <span className="font-mono text-[10px] opacity-70">{g.cols}</span>
                      {g.label}
                    </span>
                  ))}
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">{isKo ? "항목명" : "字段名"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: Math.ceil(columnSpec.length / 2) }).map((_, i) => {
                        const left = columnSpec[i * 2];
                        const right = columnSpec[i * 2 + 1];
                        return (
                          <tr key={i} className="border-t border-border/40">
                            <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{left.col}</td>
                            <td className="px-2.5 py-1.5">
                              <span className="inline-flex items-center gap-1">
                                {left.label}
                                <TooltipProvider delayDuration={200}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <CircleAlert className="w-3.5 h-3.5 text-muted-foreground cursor-help shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-[200px] text-xs">
                                      {left.desc}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </span>
                            </td>
                            {right ? (
                              <>
                                <td className="px-2.5 py-1.5 font-mono font-semibold text-primary">{right.col}</td>
                                <td className="px-2.5 py-1.5">
                                  <span className="inline-flex items-center gap-1">
                                    {right.label}
                                    <TooltipProvider delayDuration={200}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <CircleAlert className="w-3.5 h-3.5 text-muted-foreground cursor-help shrink-0" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[200px] text-xs">
                                          {right.desc}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </span>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-2.5 py-1.5" />
                                <td className="px-2.5 py-1.5" />
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownloadTemplate}>
                    <Download className="w-3.5 h-3.5" />
                    {isKo ? "템플릿 다운로드" : "下载模板"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Drop zone */}
            <div className="kpi-card section-enter" style={{ animationDelay: "60ms" }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processFile(file);
                  e.target.value = "";
                }}
              />
              <div
                className={`border-2 border-dashed rounded-lg p-10 text-center transition-all duration-200 cursor-pointer ${
                  isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) processFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium">{isKo ? "엑셀 파일(.xlsx)을 드래그하거나 클릭하여 업로드" : "拖拽或点击上传Excel文件(.xlsx)"}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("upload.maxSize")}</p>
              </div>
            </div>

            {/* Upload result */}
            {uploadResult && (
              <div className="kpi-card section-enter">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-primary" />
                    <div>
                      <h3 className="text-sm font-semibold">{uploadResult.fileName}</h3>
                      <p className="text-xs text-muted-foreground">
                        {isKo ? `총 ${uploadResult.total.toLocaleString()}행` : `共${uploadResult.total.toLocaleString()}行`}
                        {uploadResult.error > 0 && (
                          <span className="text-destructive ml-2">
                            {isKo ? `오류 ${uploadResult.error}건` : `异常${uploadResult.error}条`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {uploadResult.error > 0 && (
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5">
                      <Download className="w-3.5 h-3.5" />
                      {isKo ? "오류 행 다운로드" : "下载异常行"}
                    </Button>
                  )}
                  {!saved && (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={handleSaveToDb}
                      disabled={saving || !parsedRows.length}
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving
                        ? (isKo ? "저장 중..." : "保存中...")
                        : (isKo ? `${parsedRows.length}건 저장` : `保存${parsedRows.length}条`)}
                    </Button>
                  )}
                  {saved && (
                    <span className="flex items-center gap-1.5 text-sm text-emerald-500 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      {isKo ? "저장 완료" : "保存完成"}
                    </span>
                  )}
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-left">
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs w-10">{isKo ? "열" : "列"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "카테고리" : "类别"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs">{isKo ? "항목" : "字段"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "입력됨" : "已填"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{isKo ? "빈값" : "空值"}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-right">{t("upload.errorCount")}</th>
                        <th className="px-3 py-2 font-medium text-muted-foreground text-xs text-center">{isKo ? "결과" : "结果"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.columnResults.map((c) => (
                        <tr key={c.col} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2 font-mono font-semibold text-primary text-xs">{c.col}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{c.category}</td>
                          <td className="px-3 py-2 font-medium text-sm">{c.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.filled.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.empty > 0 ? c.empty.toLocaleString() : "-"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {c.error > 0 ? <span className="text-destructive font-medium">{c.error}</span> : "-"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {c.error === 0
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                              : <XCircle className="w-4 h-4 text-destructive mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Upload history */}
            <div className="kpi-card section-enter" style={{ animationDelay: "120ms" }}>
              <h3 className="text-sm font-medium mb-4">{t("upload.history")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.fileName")}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "데이터 행" : "数据行"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">{isKo ? "주문 건수" : "订单数"}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "결과" : "结果"}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.dateTime")}</th>
                      <th className="pb-2 font-medium text-muted-foreground">{t("upload.user")}</th>
                      <th className="pb-2 font-medium text-muted-foreground text-center">{isKo ? "관리" : "操作"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!uploadHistory.length ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                          {isKo ? "업로드 이력이 없습니다" : "暂无上传记录"}
                        </td>
                      </tr>
                    ) : (
                      uploadHistory.map((h) => (
                        <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-primary/70" />
                            {h.file_name}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">{h.row_count.toLocaleString()}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {h.error_count > 0 ? (
                              <span>
                                <span className="text-emerald-600">{h.success_count}</span>
                                <span className="text-destructive ml-1">({isKo ? `오류 ${h.error_count}` : `异常${h.error_count}`})</span>
                              </span>
                            ) : (
                              <span className="text-emerald-600">{h.success_count}</span>
                            )}
                          </td>
                          <td className="py-2.5 text-center">
                            {h.error_count === 0
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                              : <XCircle className="w-4 h-4 text-destructive mx-auto" />}
                          </td>
                          <td className="py-2.5 text-muted-foreground">{new Date(h.created_at).toLocaleString()}</td>
                          <td className="py-2.5">{h.user_email || "-"}</td>
                          <td className="py-2.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 gap-1.5 text-xs"
                                      disabled={!h.file_path}
                                      onClick={async () => {
                                        if (!h.file_path) return;
                                        const { data, error } = await supabase.storage
                                          .from("upload-files")
                                          .download(h.file_path);
                                        if (error || !data) {
                                          toast({ title: isKo ? "다운로드 실패" : "下载失败", variant: "destructive" });
                                          return;
                                        }
                                        const url = URL.createObjectURL(data);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = h.file_name;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      <Download className="w-3.5 h-3.5" />
                                      {isKo ? "다운로드" : "下载"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isKo ? "원본 파일 다운로드" : "下载原始文件"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 px-2 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                                      onClick={async () => {
                                        if (h.file_path) {
                                          await supabase.storage.from("upload-files").remove([h.file_path]);
                                        }
                                        await supabase.from("upload_history").delete().eq("id", h.id);
                                        queryClient.invalidateQueries({ queryKey: ["upload_history"] });
                                        toast({ title: isKo ? "삭제 완료" : "已删除" });
                                      }}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      {isKo ? "삭제" : "删除"}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{isKo ? "이력 및 파일 삭제" : "删除记录和文件"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, AlertTriangle, ScanLine, Truck, Send, Printer, RefreshCw, Usb, TestTube2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useShipmentScan } from "@/hooks/useShipmentScan";
import { useAddressBook } from "@/hooks/useAddressBook";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { scanSuccess, scanFail, scanDuplicate } from "@/lib/scan-sound";
import { Html5Qrcode } from "html5-qrcode";
import { ScrollArea } from "@/components/ui/scroll-area";

type FeedbackKind = "success" | "duplicate" | "mismatch" | "notfound" | "idle";

export default function ShippingScan() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useShipmentScan(orderId);
  const { data: addressBook = [] } = useAddressBook(orderId);
  const shipment = data?.shipment;
  const items = data?.items ?? [];
  const order: any = shipment?.orders;
  const total = order?.quantity ?? 0;
  const scannedCount = items.filter((i) => i.is_scanned).length;
  const allScanned = total > 0 && scannedCount === total;

  const [scanInput, setScanInput] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; msg: string }>({ kind: "idle", msg: "" });
  const [designConfirmed, setDesignConfirmed] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [carrier, setCarrier] = useState("4px");
  const [manualTracking, setManualTracking] = useState("");

  const [hidActive, setHidActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "shipping-qr-reader";
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const hidBufRef = useRef<{ buf: string; lastAt: number }>({ buf: "", lastAt: 0 });

  useEffect(() => {
    if (shipment) setDesignConfirmed(!!shipment.design_confirmed);
  }, [shipment?.id]);

  // Keep keyboard focus on USB-scanner input
  useEffect(() => {
    const refocus = () => inputRef.current?.focus();
    refocus();
    const interval = setInterval(() => {
      if (!cameraOn && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        refocus();
      }
    }, 800);
    return () => clearInterval(interval);
  }, [cameraOn]);

  // Global HID barcode-scanner listener (fast keystroke burst ending with Enter).
  // Works even when focus is on a button / select. Most machine-attached scanners
  // act as a USB HID keyboard, so this captures them reliably.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Let the visible input handle it normally (avoid double-firing)
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const now = Date.now();
      if (now - hidBufRef.current.lastAt > 80) hidBufRef.current.buf = "";
      hidBufRef.current.lastAt = now;
      if (e.key === "Enter") {
        const v = hidBufRef.current.buf.trim();
        hidBufRef.current.buf = "";
        if (v.length >= 3) {
          setHidActive(true);
          setTimeout(() => setHidActive(false), 600);
          handleScan(v);
        }
        return;
      }
      if (e.key.length === 1) hidBufRef.current.buf += e.key;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, shipment?.id]);

  // Camera scanner lifecycle
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    (async () => {
      try {
        const html5 = new Html5Qrcode(scannerDivId);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => { if (!cancelled) handleScan(decoded); },
          () => {}
        );
      } catch (err: any) {
        toast({ variant: "destructive", title: tr("카메라 오류", "相机错误"), description: String(err?.message ?? err) });
        setCameraOn(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        Promise.resolve(s.stop()).catch(() => {}).finally(() => { try { s.clear(); } catch { /* ignore */ } });
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  async function logAction(action: string, details: any) {
    await supabase.from("shipping_logs").insert({
      shipment_id: shipment?.id,
      order_id: orderId,
      action_type: action,
      worker_id: user?.id,
      details,
    });
  }

  async function handleScan(rawValue: string) {
    const qrValue = rawValue.trim();
    if (!qrValue || !shipment || !order) return;

    // debounce camera duplicates within 1.5s
    const now = Date.now();
    if (lastScanRef.current.value === qrValue && now - lastScanRef.current.at < 1500) return;
    lastScanRef.current = { value: qrValue, at: now };

    // Already scanned in this shipment?
    if (items.some((i) => i.qr_value === qrValue && i.is_scanned)) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("이미 스캔된 QR입니다", "该二维码已扫描") });
      await logAction("duplicate", { qrValue });
      return;
    }

    // Look up in hologram master — the QR on the hologram sticker identifies the parcel.
    const { data: master, error } = await supabase
      .from("qr_hologram_master")
      .select("qr_value, serial_number, hologram_type")
      .eq("qr_value", qrValue)
      .maybeSingle();

    if (error || !master) {
      scanFail();
      setFeedback({ kind: "notfound", msg: tr("등록되지 않은 홀로그램 QR입니다", "未注册的全息二维码") });
      await logAction("notfound", { qrValue });
      return;
    }

    // Fill next empty slot
    const slot = items.find((i) => !i.is_scanned);
    if (!slot) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("모든 슬롯이 가득 찼습니다", "已全部扫描完成") });
      return;
    }

    const { error: upErr } = await supabase
      .from("shipment_scan_items")
      .update({
        qr_value: qrValue,
        is_scanned: true,
        scanned_at: new Date().toISOString(),
        scanned_by: user?.id,
      })
      .eq("id", slot.id);

    if (upErr) {
      scanFail();
      setFeedback({ kind: "notfound", msg: upErr.message });
      return;
    }

    const newCount = scannedCount + 1;
    await supabase
      .from("shipments")
      .update({
        scanned_count: newCount,
        scan_status: newCount >= total ? (shipment.scan_status === "ready" || shipment.scan_status === "shipped" ? shipment.scan_status : "scanning") : "scanning",
      })
      .eq("id", shipment.id);

    await logAction("scan", { qrValue, position: slot.position });
    scanSuccess();
    setFeedback({ kind: "success", msg: tr(`${slot.position}번 슬롯 스캔 완료 (${newCount}/${total})`, `第 ${slot.position} 槽完成 (${newCount}/${total})`) });
    setScanInput("");
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = scanInput;
      setScanInput("");
      if (v.trim()) handleScan(v);
    }
  }

  async function toggleDesignConfirmed(v: boolean) {
    setDesignConfirmed(v);
    if (!shipment) return;
    await supabase.from("shipments").update({ design_confirmed: v }).eq("id", shipment.id);
  }

  function genMockTracking() {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `MOCK-${ymd}-${rnd}`;
  }

  async function issueTracking(autoMock: boolean) {
    if (!shipment) return;
    const trackingNumber = autoMock ? genMockTracking() : manualTracking.trim();
    if (!trackingNumber) {
      toast({ variant: "destructive", title: tr("송장번호를 입력하세요", "请输入运单号") });
      return;
    }
    setIssuing(true);
    const { error } = await supabase
      .from("shipments")
      .update({
        tracking_number: trackingNumber,
        carrier,
        scan_status: "ready",
        status: "label_received",
        tracking_issued_at: new Date().toISOString(),
      })
      .eq("id", shipment.id);
    setIssuing(false);
    if (error) {
      toast({ variant: "destructive", title: tr("발급 실패", "出运单失败"), description: error.message });
      return;
    }
    await logAction("issue_tracking", { trackingNumber, carrier, mock: autoMock });
    toast({ title: tr("송장이 발급되었습니다", "已生成运单"), description: trackingNumber });
    setLabelDialog(true);
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  async function markShippedAndReport() {
    if (!shipment) return;
    await supabase
      .from("shipments")
      .update({ scan_status: "shipped", status: "shipped", shipped_at: new Date().toISOString() })
      .eq("id", shipment.id);
    await logAction("report", { tracking_number: shipment.tracking_number });
    // notify_tracking_update trigger fires on tracking_number change; here we already set it earlier.
    // Mark reported optimistically (callback function will also flip it).
    await supabase.from("shipments").update({ scan_status: "reported", reported_at: new Date().toISOString() }).eq("id", shipment.id);
    toast({ title: tr("트윈메타에 회신되었습니다", "已回报至 TWINMETA") });
    setLabelDialog(false);
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  function buildLabelHtml(opts: { test?: boolean } = {}) {
    const test = !!opts.test;
    const carrierName = (shipment?.carrier || carrier || "TEST").toUpperCase();
    const tn = test ? `TEST-${Date.now().toString(36).toUpperCase()}` : (shipment?.tracking_number || "—");
    const name = test ? "TEST RECIPIENT" : (order?.recipient_name ?? "");
    const phone = test ? "+1 (000) 000-0000" : (order?.recipient_phone ?? "");
    const addr1 = test ? "123 Test Street" : (order?.shipping_address ?? "");
    const addr2 = test ? "Testville, CA 90000, USA"
      : [order?.shipping_city, order?.shipping_state, order?.shipping_zip, order?.shipping_country].filter(Boolean).join(", ");
    const jobNo = test ? "JOB-TEST-0001" : (order?.external_order_id ?? "");
    const qty = test ? 1 : total;
    // Code128-ish visual bars from tracking number (purely decorative for preview/printer test)
    const bars = Array.from(tn).map((c, i) => {
      const w = (c.charCodeAt(0) % 4) + 1;
      return `<span style="display:inline-block;width:${w}px;height:14mm;background:#000;margin-right:1px;${i % 3 === 0 ? "margin-right:2px;" : ""}"></span>`;
    }).join("");
    return `<!doctype html><html><head><meta charset="utf-8"/>
      <title>Label ${tn}</title>
      <style>
        @page { size: 70mm 130mm; margin: 0; }
        html, body { margin: 0; padding: 0; }
        body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; background: #fff; }
        .label { width: 70mm; height: 130mm; padding: 4mm; box-sizing: border-box; display: flex; flex-direction: column; gap: 2mm; }
        .row { display: flex; justify-content: space-between; align-items: center; }
        .carrier { font-size: 14pt; font-weight: 800; letter-spacing: 1px; }
        .test-tag { font-size: 8pt; padding: 1mm 2mm; border: 1px solid #000; border-radius: 2mm; }
        .hr { border-top: 1px dashed #000; margin: 1mm 0; }
        .to-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 1px; color: #444; }
        .name { font-size: 11pt; font-weight: 700; }
        .addr { font-size: 9pt; line-height: 1.25; }
        .meta { font-size: 7.5pt; color: #222; }
        .bars { text-align: center; line-height: 0; }
        .tn { text-align: center; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10pt; letter-spacing: 1px; margin-top: 1mm; }
        .footer { margin-top: auto; font-size: 7pt; color: #555; text-align: center; }
      </style></head>
      <body><div class="label">
        <div class="row">
          <div class="carrier">${carrierName}</div>
          ${test ? '<div class="test-tag">TEST PRINT</div>' : ""}
        </div>
        <div class="hr"></div>
        <div class="to-label">To / 收件人</div>
        <div class="name">${name}</div>
        <div class="addr">${addr1}<br/>${addr2}<br/>${phone}</div>
        <div class="hr"></div>
        <div class="bars">${bars}</div>
        <div class="tn">${tn}</div>
        <div class="meta">Job No: ${jobNo} · Qty: ${qty}</div>
        <div class="footer">TWINMETA FACTORY · 70 × 130 mm</div>
      </div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),150)};</script>
      </body></html>`;
  }

  function downloadLabelPdf() {
    if (!shipment) return;
    const w = window.open("", "_blank", "width=320,height=560");
    if (!w) return;
    w.document.write(buildLabelHtml());
    w.document.close();
  }

  function printTestLabel() {
    const w = window.open("", "_blank", "width=320,height=560");
    if (!w) return;
    w.document.write(buildLabelHtml({ test: true }));
    w.document.close();
    toast({ title: tr("테스트 송장 출력", "测试运单打印"), description: tr("프린터 대화창이 열렸습니다 (70×130mm)", "已打开打印对话框 (70×130mm)") });
  }

  const feedbackBox = useMemo(() => {
    if (feedback.kind === "idle") return null;
    const map: Record<FeedbackKind, string> = {
      success: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
      duplicate: "bg-amber-500/15 border-amber-500/40 text-amber-300",
      mismatch: "bg-destructive/15 border-destructive/40 text-destructive",
      notfound: "bg-destructive/15 border-destructive/40 text-destructive",
      idle: "",
    };
    const Icon = feedback.kind === "success" ? CheckCircle2 : AlertTriangle;
    return (
      <Alert className={`${map[feedback.kind]} border`}>
        <Icon className="w-4 h-4" />
        <AlertDescription className="font-medium">{feedback.msg}</AlertDescription>
      </Alert>
    );
  }, [feedback]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{tr("불러오는 중...", "加载中...")}</div>;
  if (!shipment) return (
    <div className="p-8 text-center space-y-3">
      <p className="text-muted-foreground">{tr("주문을 찾을 수 없습니다", "找不到订单")}</p>
      <Button variant="outline" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록", "返回")}</Button>
    </div>
  );

  const readyToIssue = allScanned && designConfirmed && !shipment.tracking_number;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록으로", "返回列表")}</Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1"/>{tr("새로고침", "刷新")}</Button>
        </div>
      </div>

      <PageHeader title={`QR ${tr("스캔 작업", "扫码作业")}`} description={`Job No · ${order?.external_order_id}`} />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Scanner panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><ScanLine className="w-4 h-4"/>{tr("홀로그램 스티커 QR 스캔", "扫描全息贴纸二维码")}</span>
              <Badge variant="outline" className={`gap-1 ${hidActive ? "border-emerald-500/60 text-emerald-300 bg-emerald-500/10" : "text-muted-foreground"}`}>
                <Usb className="w-3 h-3" />
                {hidActive ? tr("스캐너 신호 감지", "扫描信号") : tr("스캐너 대기", "扫描就绪")}
              </Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {tr("홀로그램 스티커의 QR을 스캔하면 해당 주소지와 매칭되어 송장이 생성됩니다.", "扫描全息贴纸二维码后将匹配收件地址并生成运单。")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={tr("기계 부착 스캐너 / USB / 직접 입력 후 Enter", "机器扫描器 / USB / 输入后回车")}
                className="font-mono"
                autoFocus
              />
              <Button variant={cameraOn ? "destructive" : "outline"} onClick={() => setCameraOn((v) => !v)}>
                {cameraOn ? <CameraOff className="w-4 h-4 mr-1"/> : <Camera className="w-4 h-4 mr-1"/>}
                {cameraOn ? tr("카메라 끄기", "关闭相机") : tr("카메라", "相机")}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {tr("※ 기계에 연결된 HID 스캐너는 페이지 어디에 포커스가 있어도 자동 인식됩니다.", "※ 机器连接的 HID 扫描器无论焦点在何处都会自动识别。")}
            </p>
            {cameraOn && <div id={scannerDivId} className="rounded-lg overflow-hidden bg-black aspect-video max-w-md mx-auto" />}
            {feedbackBox}
          </CardContent>
        </Card>

        {/* Order panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tr("주문 정보", "订单信息")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Job No</span><span className="font-mono">{order?.external_order_id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Twinker</span><span>{order?.recipient_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("전화", "电话")}</span><span className="font-mono text-xs">{order?.recipient_phone ?? "-"}</span></div>
            <div className="text-muted-foreground pt-1">{tr("주소", "地址")}</div>
            <div className="text-xs">{order?.shipping_address}, {order?.shipping_city}, {order?.shipping_state} {order?.shipping_zip}</div>
            <div className="pt-2 border-t flex items-center justify-between">
              <span className="text-muted-foreground">{tr("진행률", "进度")}</span>
              <span className="font-mono">{scannedCount}/{total}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: total ? `${(scannedCount / total) * 100}%` : "0%" }} />
            </div>
            <div className="pt-2">
              <Badge variant="outline" className="capitalize">{shipment.scan_status}</Badge>
              {shipment.tracking_number && (
                <div className="mt-2 text-xs font-mono break-all p-2 rounded bg-muted">{shipment.carrier?.toUpperCase()} · {shipment.tracking_number}</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Design verification + Address book */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{tr("디자인 검수 / 주소록", "设计检验 / 地址簿")}</span>
            <label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={designConfirmed} onCheckedChange={(v) => toggleDesignConfirmed(!!v)} />
              {tr("디자인 확인 완료", "设计已确认")}
            </label>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="design" className="w-full">
            <TabsList>
              <TabsTrigger value="design">{tr("디자인 검수", "设计检验")} ({items.length})</TabsTrigger>
              <TabsTrigger value="address">{tr("주소록", "地址簿")} ({addressBook.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="design" className="mt-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {items.map((it) => (
                  <div key={it.id} className={`rounded-lg border overflow-hidden ${it.is_scanned ? "border-emerald-500/40" : "border-border"}`}>
                    <div className="aspect-square bg-muted relative flex items-center justify-center">
                      {it.design_image_url ? (
                        <img src={it.design_image_url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xs text-muted-foreground">{tr("이미지 없음", "无图")}</span>
                      )}
                      <div className="absolute top-1 left-1 text-[10px] bg-background/80 rounded px-1.5 py-0.5 font-mono">#{it.position}</div>
                      {it.is_scanned && (
                        <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                        </div>
                      )}
                    </div>
                    <div className="p-2 text-[11px] space-y-0.5">
                      <div className="font-mono truncate" title={it.qr_value ?? ""}>{it.qr_value ?? tr("대기", "待扫")}</div>
                      <div className="text-muted-foreground truncate">{[it.color, it.size].filter(Boolean).join(" · ") || "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="address" className="mt-4">
              <p className="text-[11px] text-muted-foreground mb-2">
                {tr("주문 데이터 가져오기에서 연동된 주문 목록입니다. 클릭하면 해당 주문의 스캔 화면으로 이동합니다.",
                    "已通过\"订单数据导入\"关联的订单列表，点击可切换到对应订单的扫码页面。")}
              </p>
              <ScrollArea className="h-[420px] border rounded-md">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background border-b text-xs text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Job No</th>
                      <th className="text-left px-3 py-2">{tr("Twinker (받는사람)", "Twinker (收件人)")}</th>
                      <th className="text-left px-3 py-2">{tr("전화", "电话")}</th>
                      <th className="text-left px-3 py-2">{tr("주소", "地址")}</th>
                      <th className="text-left px-3 py-2">{tr("도시/지역", "城市/州")}</th>
                      <th className="text-center px-3 py-2">Qty</th>
                      <th className="text-left px-3 py-2">{tr("상태", "状态")}</th>
                      <th className="text-left px-3 py-2">{tr("송장번호", "运单号")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addressBook.map((o: any) => {
                      const s = o.shipments?.[0];
                      const active = o.id === orderId;
                      return (
                        <tr
                          key={o.id}
                          onClick={() => navigate(`/shipping/scan/${o.id}`)}
                          className={`cursor-pointer hover:bg-accent/40 border-b transition-colors ${active ? "bg-primary/10" : ""}`}
                        >
                          <td className="px-3 py-2 font-mono text-xs">{o.external_order_id}</td>
                          <td className="px-3 py-2 font-medium">{o.recipient_name ?? "-"}</td>
                          <td className="px-3 py-2 font-mono text-xs">{o.recipient_phone ?? "-"}</td>
                          <td className="px-3 py-2 text-xs max-w-[260px] truncate" title={o.shipping_address}>{o.shipping_address}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {[o.shipping_city, o.shipping_state, o.shipping_zip, o.shipping_country].filter(Boolean).join(", ")}
                          </td>
                          <td className="px-3 py-2 text-center font-mono">{o.quantity ?? 0}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px] capitalize">{s?.scan_status ?? "pending"}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{s?.tracking_number ?? "-"}</td>
                        </tr>
                      );
                    })}
                    {addressBook.length === 0 && (
                      <tr><td colSpan={8} className="text-center text-xs text-muted-foreground py-8">
                        {tr("주문 데이터 가져오기 메뉴에서 연동된 주문이 없습니다.", "暂无通过\"订单数据导入\"关联的订单。")}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Action bar */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{tr("택배사", "承运商")}</Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="4px">4PX</SelectItem>
                  <SelectItem value="yunexpress">YunExpress</SelectItem>
                  <SelectItem value="cjlogistics">CJ Logistics</SelectItem>
                  <SelectItem value="usps">USPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{tr("송장번호 (수기 입력 시)", "运单号（手动输入）")}</Label>
              <Input value={manualTracking} onChange={(e) => setManualTracking(e.target.value)} placeholder={tr("비워두면 자동발급(MOCK)", "留空则自动生成 (MOCK)")} className="font-mono"/>
            </div>
          </div>
          <div className="flex gap-2">
            <Button disabled={!readyToIssue || issuing} onClick={() => issueTracking(!manualTracking.trim())}>
              <Truck className="w-4 h-4 mr-1"/>{tr("송장 발급", "出运单")}
            </Button>
            <Button variant="outline" disabled={!shipment.tracking_number} onClick={downloadLabelPdf}>
              <Printer className="w-4 h-4 mr-1"/>{tr("라벨 출력", "打印标签")}
            </Button>
            <Button variant="secondary" disabled={!shipment.tracking_number || shipment.scan_status === "reported"} onClick={markShippedAndReport}>
              <Send className="w-4 h-4 mr-1"/>{tr("발송 + 회신", "发货并回报")}
            </Button>
          </div>
        </CardContent>
        {!allScanned && (
          <div className="px-4 pb-4 text-xs text-muted-foreground">{tr("모든 상품을 스캔하고 디자인 확인을 체크하면 송장 발급이 활성화됩니다.", "完成全部扫描并确认设计后方可出运单。")}</div>
        )}
      </Card>

      {/* Label dialog */}
      <Dialog open={labelDialog} onOpenChange={setLabelDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr("송장 발급 완료", "运单已生成")}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="p-3 rounded bg-muted font-mono text-center text-lg">{shipment.tracking_number}</div>
            <p className="text-muted-foreground">{tr("라벨을 출력하고 발송 후 트윈메타에 회신하세요.", "请打印标签，发货后回报 TWINMETA。")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={downloadLabelPdf}><Printer className="w-4 h-4 mr-1"/>{tr("라벨 출력", "打印标签")}</Button>
            <Button onClick={markShippedAndReport}><Send className="w-4 h-4 mr-1"/>{tr("발송 + 회신", "发货并回报")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

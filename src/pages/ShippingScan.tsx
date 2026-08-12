import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, AlertTriangle, ScanLine, Truck, Send, Printer, RefreshCw, Usb, TestTube2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useShipmentScan } from "@/hooks/useShipmentScan";
import { useHologramSerials } from "@/hooks/useHologramSerials";
import { useCouriers, requestCarrierLabel } from "@/hooks/useCouriers";

import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { scanSuccess, scanFail, scanDuplicate } from "@/lib/scan-sound";
import { buildFpxLabelHtml } from "@/lib/label-4px";

import { Html5Qrcode } from "html5-qrcode";
import { ScrollArea } from "@/components/ui/scroll-area";

type FeedbackKind = "success" | "duplicate" | "mismatch" | "notfound" | "idle";

// 🧪 Test QR code → bound to a fixed test recipient. Scanning this value
// (from the on-screen / printed QR) instantly opens a 70×130mm label
// prefilled with TEST_RECIPIENT and triggers the printer dialog.
const TEST_QR_VALUE = "TWINMETA-TEST-LABEL-001";
const TEST_RECIPIENT = {
  carrier: "4PX",
  trackingNumber: "TEST-4PX-2026-0001",
  jobNo: "JOB-TEST-0001",
  name: "Hong Gildong (테스트)",
  phone: "+82 10-1234-5678",
  address1: "123 Test Street, Apt 4B",
  address2: "Seoul, 06000, Korea",
  qty: 1,
};



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
  const shipment = data?.shipment;
  const items = data?.items ?? [];
  const { data: holoSerials = {} } = useHologramSerials(items.map((i: any) => i.qr_value ?? ""));
  const order: any = shipment?.orders;
  // Hologram sticker unique numbers — identical rule to 홀로그램 스티커 공장 detail list:
  // uniqueNo = `${item.order_id || item.sequence_no || index+1}-3`
  const holoUniqueNos = useMemo<string[]>(() => {
    const src: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];
    const count = Math.max(src.length, order?.quantity ?? 0);
    return Array.from({ length: count }, (_, idx) => {
      const it = src[idx] || {};
      const individualOrderNo = (it.order_id as string) || (it.sequence_no as string) || `${idx + 1}`;
      return `${individualOrderNo}-3`;
    });
  }, [order]);
  const total = order?.quantity ?? 0;
  const scannedCount = items.filter((i) => i.is_scanned).length;
  const allScanned = total > 0 && scannedCount === total;


  const [scanInput, setScanInput] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; msg: string }>({ kind: "idle", msg: "" });
  const [testMode, setTestMode] = useState(true);
  // "sandbox" = open-test.4px.com, "live_cancel" = production endpoint then cancel
  const [testVariant, setTestVariant] = useState<"sandbox" | "live_cancel">("sandbox");
  const [issuing, setIssuing] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Sandbox label PDF returned by the carrier during a test issuance.
  const [testLabelUrl, setTestLabelUrl] = useState<string | null>(null);

  const [carrier, setCarrier] = useState("");
  const [manualTracking, setManualTracking] = useState("");
  const { data: couriers = [] } = useCouriers(true);

  useEffect(() => {
    if (carrier || couriers.length === 0) return;
    const current = shipment?.carrier && couriers.find((c) => c.code === shipment.carrier);
    setCarrier((current ?? couriers.find((c) => c.is_default) ?? couriers[0]).code);
  }, [couriers, shipment?.carrier, carrier]);


  const [hidActive, setHidActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "shipping-qr-reader";
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const hidBufRef = useRef<{ buf: string; lastAt: number }>({ buf: "", lastAt: 0 });


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
    if (!qrValue) return;

    // debounce duplicates within 1.5s
    const now = Date.now();
    if (lastScanRef.current.value === qrValue && now - lastScanRef.current.at < 1500) return;
    lastScanRef.current = { value: qrValue, at: now };

    // 🧪 Intercept TEST QR — bypass DB lookup, render label and open printer.
    if (qrValue === TEST_QR_VALUE) {
      scanSuccess();
      setFeedback({ kind: "success", msg: tr("테스트 QR 인식 → 송장 출력", "测试二维码识别 → 打印运单") });
      setScanInput("");
      printTestLabel();
      return;
    }

    if (!shipment || !order) return;

    // Already scanned in this shipment?
    if (items.some((i) => i.qr_value === qrValue && i.is_scanned)) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("이미 스캔된 QR입니다", "该二维码已扫描") });
      await logAction("duplicate", { qrValue });
      return;
    }

    // Look up in hologram master — the QR on the hologram sticker identifies the parcel.
    const { data: master } = await supabase
      .from("qr_hologram_master")
      .select("qr_value, serial_number, hologram_type")
      .eq("qr_value", qrValue)
      .maybeSingle();

    // Also accept the hologram unique numbers shown in the detail list (`{주문번호}-3`).
    const knownHere = holoUniqueNos.includes(qrValue) || items.some((i) => i.qr_value === qrValue);

    if (!master && !knownHere) {
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

    // Auto-issue + print the waybill for the scanned parcel.
    if (!issuing) void issueTrackingViaApi();
  }


  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = scanInput;
      setScanInput("");
      if (v.trim()) handleScan(v);
    }
  }

  function genMockTracking() {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `MOCK-${ymd}-${rnd}`;
  }

  // Call the selected courier's API to create the label / tracking number.
  // In test mode the carrier credentials are verified (4PX signed call) but no real
  // waybill is created — a simulated tracking number is printed instead.
  async function issueTrackingViaApi() {
    if (!shipment) return;
    if (!carrier) {
      toast({ variant: "destructive", title: tr("택배사를 선택하세요", "请选择承运商") });
      return;
    }
    setIssuing(true);
    try {
      const res = await requestCarrierLabel(shipment.id, carrier, testMode, testVariant);
      if (testMode) {
        await logAction("issue_tracking_test", { trackingNumber: res.tracking_number, carrier, via: "api-test", variant: testVariant });
        const cancelled = (res as any)?.cancelled;
        toast({
          title: testVariant === "live_cancel"
            ? (cancelled === false
                ? tr("운영 테스트 송장 생성됨 · 자동취소 실패", "生产测试运单已生成 · 自动取消失败")
                : tr("운영 테스트 송장 생성 후 취소됨", "生产测试运单已生成并取消"))
            : tr("테스트 송장 생성 (실제 발급 아님)", "测试运单已生成（非真实运单）"),
          variant: testVariant === "live_cancel" && cancelled === false ? "destructive" : undefined,
          description: `${res.tracking_number}${(res as any)?.message ? ` · ${(res as any).message}` : ""}`,
        });
        const url = (res as any)?.label_url as string | undefined;
        setTestLabelUrl(url ?? null);
        if (url) {
          const size = labelSizeFor(carrier || shipment?.carrier);
          const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
          if (w) { w.document.write(buildRemoteLabelHtml(url, carrier || shipment?.carrier)); w.document.close(); }
        } else {
          toast({
            variant: "destructive",
            title: tr("4PX 공식 송장(PDF)을 받지 못했습니다", "未获取到4PX官方面单(PDF)"),
            description: tr("임시 미리보기를 출력합니다. 4PX에 ds.xms.label.get 권한을 확인하세요.", "已输出临时预览。请确认4PX的 ds.xms.label.get 权限。"),
          });
          printSimulatedLabel(res.tracking_number);
        }


        return;
      }
      await logAction("issue_tracking", { trackingNumber: res.tracking_number, carrier, via: "api" });
      toast({ title: tr("송장이 발급되었습니다", "已生成运单"), description: res.tracking_number });
      // Auto-print the carrier-issued waybill right after issuance.
      const liveUrl = (res as any)?.label_url as string | undefined;
      if (liveUrl) {
        const size = labelSizeFor(carrier || shipment?.carrier);
        const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
        if (w) { w.document.write(buildRemoteLabelHtml(liveUrl, carrier || shipment?.carrier)); w.document.close(); }
      } else {
        setLabelDialog(true);
      }
      qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });

    } catch (e: any) {
      toast({
        variant: "destructive",
        title: testMode
          ? tr("테스트 송장 발급 실패", "测试运单生成失败")
          : tr("택배사 API 발급 실패", "承运商API出运单失败"),
        description: e?.message ?? tr("알 수 없는 오류", "未知错误"),
      });
    } finally {
      setIssuing(false);
    }
  }

  // Manual entry fallback (used when the courier issues the number offline).
  async function issueTrackingManual() {
    if (!shipment) return;
    const trackingNumber = manualTracking.trim();
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
    await logAction("issue_tracking", { trackingNumber, carrier, via: "manual" });
    toast({ title: tr("송장이 등록되었습니다", "已登记运单"), description: trackingNumber });
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

  // 완료된 스캔/송장 상태를 모두 되돌린다 (재작업용).
  async function resetScanWork() {
    if (!shipment) return;
    setResetting(true);
    const { error: e1 } = await supabase
      .from("shipment_scan_items")
      .update({ qr_value: null, is_scanned: false, scanned_at: null, scanned_by: null })
      .eq("shipment_id", shipment.id);
    const { error: e2 } = await supabase
      .from("shipments")
      .update({
        scanned_count: 0,
        scan_status: "pending",
        status: "pending",
        tracking_number: null,
        tracking_issued_at: null,
        shipped_at: null,
        reported_at: null,
        design_confirmed: false,
      })
      .eq("id", shipment.id);
    setResetting(false);
    if (e1 || e2) {
      toast({ variant: "destructive", title: tr("초기화 실패", "重置失败"), description: (e1 ?? e2)?.message });
      return;
    }
    await logAction("reset", { shipment_id: shipment.id });
    setResetOpen(false);
    setLabelDialog(false);
    setFeedback({ kind: "idle", msg: "" });
    setScanInput("");
    toast({ title: tr("초기화되었습니다", "已重置") });
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
    qc.invalidateQueries({ queryKey: ["shipping_queue"] });
    qc.invalidateQueries({ queryKey: ["shipping_queue_kpis"] });
  }

  // Label geometry per carrier. 4PX ships 100×150mm (10×15cm) labels.
  function labelSizeFor(code?: string | null) {
    const c = (code ?? "").toLowerCase();
    if (c === "4px") return { w: 100, h: 150 };
    return { w: 70, h: 130 };
  }

  function buildLabelHtml(opts: { test?: boolean; testTracking?: string; noPrint?: boolean } = {}) {
    // `test` = fixed dummy recipient (printer check).
    // `testTracking` = real order data, simulated tracking number (4PX test mode).
    const test = !!opts.test;
    const simulated = !!opts.testTracking;
    const carrierCode = test ? TEST_RECIPIENT.carrier : (shipment?.carrier || carrier || "");
    const size = labelSizeFor(carrierCode);
    const tn = opts.testTracking ?? (test ? TEST_RECIPIENT.trackingNumber : (shipment?.tracking_number || "—"));
    const qty = test ? TEST_RECIPIENT.qty : (total || 1);

    return buildFpxLabelHtml(
      {
        carrierName: (carrierCode || "TEST").toUpperCase(),
        trackingNumber: tn,
        fpxTrackingNo: (shipment as any)?.carrier_response?.create?.data?.["4px_tracking_no"] ?? null,
        serviceCode: null,
        refNo: test ? TEST_RECIPIENT.jobNo : (order?.external_order_id ?? ""),
        createdAt: shipment?.tracking_issued_at ?? null,
        weightGrams: (shipment as any)?.weight_grams ?? (shipment as any)?.expected_weight_grams ?? qty * 200,
        pieces: 1,
        test: test || simulated,
        recipient: test
          ? {
              name: TEST_RECIPIENT.name,
              phone: TEST_RECIPIENT.phone,
              street: TEST_RECIPIENT.address1,
              city: "Seoul",
              state: "",
              zip: "06000",
              country: "KR",
            }
          : {
              name: order?.recipient_name,
              phone: order?.recipient_phone,
              street: order?.shipping_address,
              city: order?.shipping_city,
              state: order?.shipping_state,
              zip: order?.shipping_zip,
              country: order?.shipping_country ?? "US",
            },
        sender: {
          company: "TWINMETA",
          name: "TWINMETA",
          phone: "+86 13000000000",
          street: "-",
          city: "Shenzhen",
          state: "GuangDong",
          zip: "518000",
          country: "CN",
        },
        declarations: [{ nameEn: "T-Shirt", nameCn: "T恤", qty, price: 10 }],
        width: size.w,
        height: size.h,
      },
      { print: !opts.noPrint },
    );
  }


  // Carrier-issued waybill (4PX ds.xms.label.get), forced to the carrier's paper size.
  // Accepts a URL, a base64 data-URL PDF, or an HTML label returned by the carrier.
  function buildRemoteLabelHtml(url: string, code?: string | null, noPrint = false) {
    const { w: LW, h: LH } = labelSizeFor(code);
    const isImg = /^data:image\//i.test(url) || /\.(png|jpe?g)$/i.test(url);
    const isHtml = /^data:text\/html/i.test(url) || /\.html?$/i.test(url);
    const printScript = noPrint ? "" : `<script>window.onload=()=>{setTimeout(()=>window.print(),800)};<\/script>`;
    const body = isImg
      ? `<img src="${url}"/>`
      : isHtml
        ? `<iframe src="${url}" frameborder="0"></iframe>`
        : `<embed src="${url}#toolbar=0" type="application/pdf"/>`;
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
      <style>
        @page { size: ${LW}mm ${LH}mm; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${LW}mm; height: ${LH}mm; }
        embed, img, iframe { width: ${LW}mm; height: ${LH}mm; object-fit: contain; display: block; border: 0; }
      </style></head><body>
      ${body}${printScript}
      </body></html>`;
  }


  function downloadLabelPdf() {
    if (!shipment) return;
    const size = labelSizeFor(shipment.carrier || carrier);
    const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    const labelUrl = (shipment as any).label_url as string | null | undefined;
    w.document.write(
      labelUrl
        ? buildRemoteLabelHtml(labelUrl, shipment.carrier || carrier)
        : buildLabelHtml(),
    );
    w.document.close();
  }

  function printTestLabel() {
    const size = labelSizeFor(TEST_RECIPIENT.carrier);
    const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(buildLabelHtml({ test: true }));
    w.document.close();
    toast({
      title: tr("테스트 송장 출력", "测试运单打印"),
      description: tr(`프린터 대화창이 열렸습니다 (${size.w}×${size.h}mm)`, `已打开打印对话框 (${size.w}×${size.h}mm)`),
    });
  }

  // Test-mode label: real order/address data, simulated (non-billable) tracking number.
  function printSimulatedLabel(trackingNumber: string) {
    const size = labelSizeFor(carrier || shipment?.carrier);
    const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(buildLabelHtml({ testTracking: trackingNumber }));
    w.document.close();
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

  const previewSize = labelSizeFor(shipment.carrier || carrier);
  const sizeLabel = `${previewSize.w} × ${previewSize.h} mm`;
  // Real device pixels for the label at 96dpi, then scaled down to fit the card.
  const mmPx = (mm: number) => (mm * 96) / 25.4;
  const previewScale = 230 / mmPx(previewSize.w);
  const remoteLabelUrl = ((shipment as any).label_url as string | null | undefined) ?? testLabelUrl;
  // The preview renders the exact same markup the printer receives.
  const previewHtml = remoteLabelUrl
    ? buildRemoteLabelHtml(remoteLabelUrl, shipment.carrier || carrier, true)
    : buildLabelHtml({ testTracking: testMode && !shipment.tracking_number ? "TEST-PREVIEW-0000" : undefined, noPrint: true });

  const readyToIssue = testMode
    ? !!carrier
    : allScanned && !shipment.tracking_number;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록으로", "返回列表")}</Button>
        <div className="flex items-center gap-3">
          <label
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
              testMode ? "border-amber-500/60 bg-amber-500/10 text-foreground" : "text-muted-foreground"
            }`}
          >
            <TestTube2 className="w-4 h-4" />
            {tr("테스트 모드", "测试模式")}
            <Switch checked={testMode} onCheckedChange={setTestMode} />
          </label>
          {testMode && (
            <Select value={testVariant} onValueChange={(v) => setTestVariant(v as "sandbox" | "live_cancel")}>
              <SelectTrigger className="w-[230px] h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">{tr("샌드박스 (open-test)", "沙箱 (open-test)")}</SelectItem>
                <SelectItem value="live_cancel">{tr("운영주소 테스트 (발급 후 취소)", "生产地址测试（出单后取消）")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1"/>{tr("새로고침", "刷新")}</Button>
          <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="w-4 h-4 mr-1"/>{tr("초기화", "重置")}
          </Button>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("스캔 작업 초기화", "重置扫码作业")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tr("이 주문의 완료된 스캔 기록과 송장 발급/발송 상태가 모두 초기화되어 처음부터 다시 작업할 수 있습니다.",
                "该订单已完成的扫码记录及运单/发货状态将全部重置，可重新作业。")}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>{tr("취소", "取消")}</Button>
            <Button variant="destructive" disabled={resetting} onClick={resetScanWork}>
              {resetting ? tr("초기화 중...", "重置中...") : tr("초기화", "重置")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Order detail list (items of the selected order) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{tr("주소록 · 주문 상세 목록", "地址簿 · 订单明细")}</span>
            <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[11px] text-muted-foreground mb-2">
            {tr("선택한 주문건의 상세 목록입니다. 송장번호가 발급되면 자동으로 반영됩니다.",
                "所选订单的明细列表，运单号生成后会自动同步。")}
          </p>
          <ScrollArea className="h-[420px] border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b text-xs text-muted-foreground">
                <tr>
                  <th className="text-center px-3 py-2">#</th>
                  <th className="text-left px-3 py-2">{tr("홀로그램 고유번호", "全息码")}</th>
                  <th className="text-left px-3 py-2">QR</th>
                  <th className="text-left px-3 py-2">{tr("제품/색상/사이즈", "产品/颜色/尺码")}</th>
                  <th className="text-left px-3 py-2">{tr("Twinker (받는사람)", "Twinker (收件人)")}</th>
                  <th className="text-left px-3 py-2">{tr("전화", "电话")}</th>
                  <th className="text-left px-3 py-2">{tr("주소", "地址")}</th>
                  <th className="text-left px-3 py-2">{tr("도시/지역/국가", "城市/州/国家")}</th>
                  <th className="text-center px-3 py-2">{tr("스캔", "扫码")}</th>
                  <th className="text-left px-3 py-2">{tr("택배사", "承运商")}</th>
                  <th className="text-left px-3 py-2">{tr("송장번호", "运单号")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: any) => {
                  const holo = it.qr_value ? holoSerials[it.qr_value] : undefined;
                  const holoNo = holoUniqueNos[(it.position ?? 1) - 1] || holo?.serial || "-";
                  return (
                    <tr key={it.id} className="border-b hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-2 text-center font-mono text-xs">{it.position}</td>
                      <td className="px-3 py-2 font-mono text-xs">{holoNo}</td>
                      <td className="px-3 py-2 font-mono text-xs max-w-[180px] truncate" title={it.qr_value ?? ""}>{it.qr_value ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">
                        {[it.product_code, it.color, it.size].filter(Boolean).join(" / ") || "-"}
                      </td>
                      <td className="px-3 py-2 font-medium">{order?.recipient_name ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{order?.recipient_phone ?? "-"}</td>
                      <td className="px-3 py-2 text-xs max-w-[240px] truncate" title={order?.shipping_address ?? ""}>{order?.shipping_address ?? "-"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {[order?.shipping_city, order?.shipping_state, order?.shipping_zip, order?.shipping_country].filter(Boolean).join(", ")}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {it.is_scanned
                          ? <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">OK</Badge>
                          : <Badge variant="outline" className="text-[10px]">{tr("대기", "待扫")}</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs uppercase">{shipment.carrier ?? "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{shipment.tracking_number ?? "-"}</td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr><td colSpan={11} className="text-center text-xs text-muted-foreground py-8">
                    {tr("이 주문의 상세 항목이 없습니다.", "该订单暂无明细。")}
                  </td></tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>


      {/* Label preview — size follows the selected carrier (4PX = 100×150mm) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><Printer className="w-4 h-4"/>{tr("송장 미리보기", "运单预览")}</span>
            <span className="text-[11px] font-normal text-muted-foreground">{sizeLabel}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row items-start gap-6">
          <div
            className="bg-white rounded shadow-lg border border-border overflow-hidden shrink-0"
            style={{
              width: `${Math.round(mmPx(previewSize.w) * previewScale)}px`,
              height: `${Math.round(mmPx(previewSize.h) * previewScale)}px`,
            }}
          >
            <iframe
              title="label-preview"
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              scrolling="no"
              style={{
                width: `${mmPx(previewSize.w)}px`,
                height: `${mmPx(previewSize.h)}px`,
                border: "none",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
                background: "#fff",
              }}
            />
          </div>


          <div className="flex-1 space-y-3 text-sm">
            <Alert>
              <TestTube2 className="w-4 h-4" />
              <AlertDescription className="text-xs">
                {tr(
                  `프린터/스캐너 연동을 확인하려면 '테스트 출력'을 사용하세요. 브라우저 프린트 대화창에서 용지 크기 ${previewSize.w}×${previewSize.h}mm, 여백 '없음'으로 설정해야 라벨지에 정확히 출력됩니다.`,
                  `请使用『测试打印』确认打印机/扫描器连接。在打印对话框中将纸张设为 ${previewSize.w}×${previewSize.h}mm、边距设为「无」即可精准打印。`
                )}
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={printTestLabel}>
                <TestTube2 className="w-4 h-4 mr-1" />{tr("테스트 출력", "测试打印")}
              </Button>
              <Button variant="outline" disabled={!shipment.tracking_number} onClick={downloadLabelPdf}>
                <Printer className="w-4 h-4 mr-1" />{tr("실제 송장 출력", "打印当前运单")}
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-1 pt-2 border-t">
              <div>• {tr("스캐너 상태:", "扫描状态：")} <span className={hidActive ? "text-emerald-400" : ""}>{hidActive ? tr("신호 수신됨", "已接收信号") : tr("대기 중", "等待中")}</span></div>
              <div>• {tr("기계 부착 HID 스캐너는 입력 필드 포커스 없이도 자동 인식됩니다.", "机器附带的 HID 扫描器无需聚焦输入框也能识别。")}</div>
              <div>• {tr("스캔이 되지 않으면 스캐너를 다른 USB 포트에 다시 꽂아보세요.", "如未识别，请将扫描器重新插入其他 USB 端口。")}</div>
            </div>
          </div>
        </CardContent>
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

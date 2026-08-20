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

import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, AlertTriangle, ScanLine, Truck, Send, Printer, RefreshCw, RotateCcw, Usb, TestTube2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useShipmentScan } from "@/hooks/useShipmentScan";
import { useHologramSerials } from "@/hooks/useHologramSerials";
import { useCouriers, requestCarrierLabel } from "@/hooks/useCouriers";
import {
  useShippingGroupsForOrder,
  buildShippingGroups,
  issueGroupLabels,
  issueGroupLabel,
  type ShippingGroupRow,
} from "@/hooks/useShippingGroups";

import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { scanSuccess, scanFail, scanDuplicate } from "@/lib/scan-sound";
import { buildFpxLabelHtml } from "@/lib/label-4px";
import { useGlobalSetting } from "@/hooks/useGlobalSetting";
import {
  checkPrintAgent,
  printPdfViaAgent,
  fetchLabelPdf,
  PRINT_AGENT_SETTING_KEY,
  PRINT_AGENT_DEFAULTS,
  type PrintAgentSettings,
} from "@/lib/print-agent";
import { htmlLabelToPdfBlob } from "@/lib/html-label-pdf";

import { Html5Qrcode } from "html5-qrcode";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";

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
  const shipmentCarrier = shipment?.shipment_carrier_prefs?.carrier ?? shipment?.carrier;
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

  // 배송 수취인은 source_data.items[](엑셀 Q~T열) 기준입니다.
  // orders.recipient_name 은 트윈커명(C열)이라 택배 발송에는 사용하지 않습니다.
  const shipRecipientPos = (items.find((i) => !i.is_scanned)?.position
    ?? items.filter((i) => i.is_scanned).slice(-1)[0]?.position
    ?? 1) as number;
  const shipRecipient = (() => {
    const src: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];
    const si: any = src[shipRecipientPos - 1] ?? src[0] ?? {};
    return {
      name: si.recipient_name ?? "",
      phone: si.recipient_phone ?? order?.recipient_phone ?? "",
      address: si.shipping_address ?? order?.shipping_address ?? "",
      city: si.shipping_city ?? order?.shipping_city ?? "",
      state: si.shipping_state ?? order?.shipping_state ?? "",
      zip: si.shipping_zip ?? order?.shipping_zip ?? "",
      country: si.country_code ?? order?.shipping_country ?? "US",
    };
  })();



  const [scanInput, setScanInput] = useState("");
  // Print scale (%) — compensates printer drivers that shrink the page ("fit to page").
  const [labelScale, setLabelScale] = useState<number>(() => {
    const v = Number(localStorage.getItem("shipping-label-print-scale"));
    return Number.isFinite(v) && v >= 50 && v <= 300 ? v : 100;
  });
  useEffect(() => {
    localStorage.setItem("shipping-label-print-scale", String(labelScale));
  }, [labelScale]);

  // ---- Local printer agent (http://127.0.0.1:9100) --------------------------
  // Server-shared settings so every PC uses the same agent configuration.
  const { value: agentCfgRaw, persist: persistAgentCfg } = useGlobalSetting<PrintAgentSettings>(
    PRINT_AGENT_SETTING_KEY,
    PRINT_AGENT_DEFAULTS,
  );
  const agentCfg = { ...PRINT_AGENT_DEFAULTS, ...(agentCfgRaw ?? {}) } as PrintAgentSettings;
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const agentCfgRef = useRef(agentCfg);
  useEffect(() => { agentCfgRef.current = agentCfg; });
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      if (!agentCfg.enabled) { setAgentOnline(null); return; }
      const ok = await checkPrintAgent(agentCfg.baseUrl);
      if (!cancelled) setAgentOnline(ok);
    };
    void ping();
    const t = setInterval(ping, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [agentCfg.enabled, agentCfg.baseUrl]);

  /** Sends a label PDF to the local agent. Returns false when it must fall back. */
  async function sendToPrintAgent(opts: {
    url: string;
    carrierCode?: string | null;
    trackingNumber?: string | null;
    refNo?: string | null;
  }) {
    const cfg = agentCfgRef.current;
    if (!cfg.enabled) return false;
    try {
      // 4PX가 준 PDF를 그대로 전송한다 — 리사이즈/래스터화/스케일 보정 없음.
      const pdf = await fetchLabelPdf(opts.url);

      await printPdfViaAgent({
        baseUrl: cfg.baseUrl,
        printerName: cfg.printerName,
        pdf,
        pdfUrl: pdf ? null : opts.url,
        courierCode: opts.carrierCode ?? undefined,
        copies: 1,
        trackingNumber: opts.trackingNumber ?? undefined,
      });
      setAgentOnline(true);
      return true;
    } catch (e) {
      setAgentOnline(false);
      // eslint-disable-next-line no-console
      console.warn("[print-agent] failed, falling back to browser print:", (e as Error).message);
      return false;
    }
  }

  /** Sends a locally built (HTML) label to the agent by converting it to a PDF first. */
  async function sendHtmlLabelToAgent(opts: {
    html: string;
    size: { w: number; h: number };
    carrierCode?: string | null;
    trackingNumber?: string | null;
  }) {
    const cfg = agentCfgRef.current;
    if (!cfg.enabled) return false;
    try {
      const pdf = await htmlLabelToPdfBlob(opts.html, opts.size.w, opts.size.h);
      await printPdfViaAgent({
        baseUrl: cfg.baseUrl,
        printerName: cfg.printerName,
        pdf,
        courierCode: opts.carrierCode ?? undefined,
        copies: 1,
        trackingNumber: opts.trackingNumber ?? undefined,
      });
      setAgentOnline(true);
      return true;
    } catch (e) {
      setAgentOnline(false);
      // eslint-disable-next-line no-console
      console.warn("[print-agent] html label failed, falling back to browser print:", (e as Error).message);
      return false;
    }
  }

  // Calibration: print a 100×150mm ruler sheet, measure it, auto-derive the scale.
  const [calibOpen, setCalibOpen] = useState(false);
  const [measuredW, setMeasuredW] = useState("");
  const [measuredH, setMeasuredH] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; msg: string }>({ kind: "idle", msg: "" });
  const [testMode, setTestMode] = useState(false);
  // Test mode now only uses the production endpoint and cancels the order immediately.
  const testVariant: "live_cancel" = "live_cancel";
  const [issuing, setIssuing] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Sandbox label PDF returned by the carrier during a test issuance.
  const [testLabelUrl, setTestLabelUrl] = useState<string | null>(null);

  const [carrier, setCarrier] = useState("");
  const [manualTracking, setManualTracking] = useState("");
  const { data: couriers = [] } = useCouriers(true);
  // Shared default carrier (server-backed, same on every device/account).
  const { value: globalCarrier } = useGlobalSetting<string>("shipping_default_carrier", "");

  // ---- Shipping groups (pre-issued waybills) --------------------------------
  const { data: groupData, refetch: refetchGroups } = useShippingGroupsForOrder(orderId);
  const groups = (groupData?.groups ?? []) as ShippingGroupRow[];
  const groupMembers = (groupData?.members ?? []) as any[];
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const membersByGroup = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const it of groupMembers) {
      if (!it.shipping_group_id) continue;
      const arr = m.get(it.shipping_group_id) ?? [];
      arr.push(it);
      m.set(it.shipping_group_id, arr);
    }
    return m;
  }, [groupMembers]);

  const [groupTab, setGroupTab] = useState<"all" | "single" | "multi">("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [buildingGroups, setBuildingGroups] = useState(false);
  const [preIssueOpen, setPreIssueOpen] = useState(false);
  const [preIssueRunning, setPreIssueRunning] = useState(false);
  const [preIssueProgress, setPreIssueProgress] = useState({ done: 0, total: 0, success: 0, failed: 0 });
  const [preIssueLog, setPreIssueLog] = useState<{ name: string; ok: boolean; message?: string }[]>([]);
  // Pre-fetched label blobs so printing does not wait for a remote download.
  const labelCacheRef = useRef<Map<string, string>>(new Map());

  const singleGroups = useMemo(() => groups.filter((g) => (g.item_count ?? 0) <= 1), [groups]);
  const multiGroups = useMemo(() => groups.filter((g) => (g.item_count ?? 0) > 1), [groups]);
  const pendingGroups = useMemo(
    () => groups.filter((g) => !(g.tracking_number && g.label_status === "ready")),
    [groups],
  );

  // Build / refresh the groups when the packing page opens (idempotent, server side).
  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setBuildingGroups(true);
    buildShippingGroups()
      .then(() => { if (!cancelled) refetchGroups(); })
      .catch(() => { /* keep the page usable even if grouping fails */ })
      .finally(() => { if (!cancelled) setBuildingGroups(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Prefetch issued labels into blob URLs (bounded) for instant printing.
  useEffect(() => {
    const ready = groups.filter((g) => g.label_status === "ready" && g.label_url).slice(0, 40);
    let cancelled = false;
    (async () => {
      for (const g of ready) {
        if (cancelled) return;
        if (labelCacheRef.current.has(g.id)) continue;
        const url = g.label_url!;
        if (url.startsWith("data:")) { labelCacheRef.current.set(g.id, url); continue; }
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          labelCacheRef.current.set(g.id, URL.createObjectURL(blob));
        } catch { /* fall back to the remote URL at print time */ }
      }
    })();
    return () => { cancelled = true; };
  }, [groups]);

  useEffect(() => () => {
    for (const u of labelCacheRef.current.values()) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  }, []);

  // Keep the active carrier in sync with the per-order preference saved in the
  // order list. When the preference changes (e.g. 4PX -> YunExpress) the scan
  // page must switch too, otherwise pre-issuance would go to the old carrier.
  useEffect(() => {
    if (couriers.length === 0) return;
    // Priority: carrier already used by an issued group > per-order preference >
    // shared (server-side) default > courier flagged as default.
    const issued = groups.find((g) => g.carrier)?.carrier ?? null;
    const preferred =
      (issued && couriers.find((c) => c.code === issued)) ||
      (shipmentCarrier && couriers.find((c) => c.code === shipmentCarrier)) ||
      (globalCarrier && couriers.find((c) => c.code === globalCarrier));
    const next = (preferred ?? couriers.find((c) => c.is_default) ?? couriers[0]).code;
    setCarrier((prev) => (prev === next ? prev : next));
  }, [couriers, shipmentCarrier, globalCarrier, groups]);



  const [hidActive, setHidActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "shipping-qr-reader";
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const hidBufRef = useRef<{ buf: string; lastAt: number }>({ buf: "", lastAt: 0 });
  // Group whose label was already printed — offers a manual reprint button.
  const [reprintGroup, setReprintGroup] = useState<ShippingGroupRow | null>(null);


  // ---- Scan → print timing profiler (console.table) -------------------------
  const perfRef = useRef<{ t0: number; rows: { step: string; ms: number }[] }>({ t0: 0, rows: [] });
  function perfStart() {
    perfRef.current = { t0: performance.now(), rows: [{ step: "SCAN", ms: 0 }] };
  }
  function perfMark(step: string, atMs?: number) {
    if (!perfRef.current.t0) return;
    perfRef.current.rows.push({ step, ms: Math.round(atMs ?? performance.now() - perfRef.current.t0) });
  }
  function perfDump() {
    if (!perfRef.current.t0) return;
    const rows = [...perfRef.current.rows].sort((a, b) => a.ms - b.ms);
    // eslint-disable-next-line no-console
    console.table(
      rows.map((r, i) => ({
        step: r.step,
        "t (ms)": r.ms,
        "구간 (ms)": i === 0 ? 0 : r.ms - rows[i - 1].ms,
      })),
    );
  }
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as any;
      if (!d || d.type !== "label-timing") return;
      perfMark(d.step);
      if (d.step === "print_called") perfDump();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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
          const size = labelSizeFor(carrier || shipmentCarrier || "4PX");
          const printWindow = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
          if (printWindow) {
            printWindow.document.write(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">${tr("송장을 생성하고 있습니다…", "正在生成运单…")}</body></html>`);
            printWindow.document.close();
          }
          void handleScan(v, printWindow);
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

  async function handleScan(rawValue: string, printWindow?: Window | null) {
    const qrValue = rawValue.trim();
    if (!qrValue) return;

    // debounce duplicates within 1.5s
    const now = Date.now();
    if (lastScanRef.current.value === qrValue && now - lastScanRef.current.at < 1500) return;
    lastScanRef.current = { value: qrValue, at: now };
    setReprintGroup(null);


    // 🧪 Intercept TEST QR — bypass DB lookup, render label and open printer.
    if (qrValue === TEST_QR_VALUE) {
      scanSuccess();
      setFeedback({ kind: "success", msg: tr("테스트 QR 인식 → 송장 출력", "测试二维码识别 → 打印运单") });
      setScanInput("");
      void printTestLabel(printWindow);
      return;
    }

    if (!shipment || !order) return;

    // Already scanned in this shipment?
    const localDup = items.find((i) => i.qr_value === qrValue && i.is_scanned);
    if (localDup) {
      scanDuplicate();
      printWindow?.close();
      const g = offerReprint((localDup as any).shipping_group_id);
      setFeedback({
        kind: "duplicate",
        msg: g
          ? tr("이미 출력됨 · 재인쇄 버튼을 눌러 다시 출력하세요", "已打印 · 请点击重新打印按钮")
          : tr("이미 스캔된 QR입니다", "该二维码已扫描"),
      });
      await logAction("duplicate", { qrValue });
      return;
    }


    // Fast path: the QR is already known locally (detail list / existing slots),
    // so skip the hologram master round-trip entirely.
    const knownHere = holoUniqueNos.includes(qrValue) || items.some((i) => i.qr_value === qrValue);

    if (!knownHere) {
      // Look up in hologram master — the QR on the hologram sticker identifies the parcel.
      const { data: master } = await supabase
        .from("qr_hologram_master")
        .select("qr_value")
        .eq("qr_value", qrValue)
        .maybeSingle();
      if (!master) {
        scanFail();
        setFeedback({ kind: "notfound", msg: tr("등록되지 않은 홀로그램 QR입니다", "未注册的全息二维码") });
        void logAction("notfound", { qrValue });
        return;
      }
    }


    // DB-level duplicate guard (not only the 1.5s debounce).
    const { data: dupRow } = await supabase
      .from("shipment_scan_items")
      .select("id, position, shipping_group_id")
      .eq("qr_value", qrValue)
      .eq("is_scanned", true)
      .maybeSingle();
    if (dupRow) {
      scanDuplicate();
      printWindow?.close();
      const g = offerReprint((dupRow as any).shipping_group_id);
      setFeedback({
        kind: "duplicate",
        msg: g
          ? tr("이미 출력됨 · 재인쇄 버튼을 눌러 다시 출력하세요", "已打印 · 请点击重新打印按钮")
          : tr("중복 스캔 · 이미 확인된 제품입니다", "重复扫描 · 该产品已确认"),
      });
      void logAction("scan_duplicate", { qrValue, position: dupRow.position });
      return;
    }




    // Fill next empty slot
    const slot = items.find((i) => !i.is_scanned);
    if (!slot) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("모든 슬롯이 가득 찼습니다", "已全部扫描完成") });
      printWindow?.close();
      return;
    }

    const newCount = scannedCount + 1;
    perfMark("validation");
    scanSuccess();
    setScanInput("");

    const group = slot.shipping_group_id ? groupById.get(slot.shipping_group_id) ?? null : null;
    perfMark("GROUP_MATCHED");
    if (group) setActiveGroupId(group.id);

    await Promise.all([
      supabase
        .from("shipment_scan_items")
        .update({
          qr_value: qrValue,
          is_scanned: true,
          scanned_at: new Date().toISOString(),
          scanned_by: user?.id,
        })
        .eq("id", slot.id),
      supabase
        .from("shipments")
        .update({
          scanned_count: newCount,
          scan_status: newCount >= total ? (shipment.scan_status === "ready" || shipment.scan_status === "shipped" ? shipment.scan_status : "scanning") : "scanning",
        })
        .eq("id", shipment.id),
      logAction("scan_success", { qrValue, position: slot.position, shipping_group_id: group?.id ?? null }),
    ]);

    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });

    if (!group) {
      setFeedback({ kind: "success", msg: tr(`${slot.position}번 슬롯 스캔 완료 (${newCount}/${total})`, `第 ${slot.position} 槽完成 (${newCount}/${total})`) });
      printWindow?.close();
      toast({
        variant: "destructive",
        title: tr("발송 그룹이 없습니다", "无发货分组"),
        description: tr("송장 사전발행을 먼저 진행해 주세요.", "请先执行运单预发行。"),
      });
      return;
    }

    // Recount the group from the DB (multiple orders can belong to one group).
    const { data: memberRows } = await supabase
      .from("shipment_scan_items")
      .select("id, is_scanned")
      .eq("shipping_group_id", group.id);
    const scannedInGroup = (memberRows ?? []).filter((m: any) => m.is_scanned).length;
    const required = group.required_scan_count || group.item_count || 1;
    void supabase.from("shipping_groups").update({
      scanned_count: scannedInGroup,
      scan_status: scannedInGroup >= required ? "ready" : "scanning",
    }).eq("id", group.id);
    void logAction("scan_group_progress", { shipping_group_id: group.id, qrValue, scanned: scannedInGroup, required });
    void refetchGroups();

    setFeedback({
      kind: "success",
      msg: `${group.recipient_name} · ${scannedInGroup}/${required}`,
    });

    if (scannedInGroup < required) {
      printWindow?.close();
      return;
    }

    // All products of this shipping group confirmed → print the pre-issued label.
    void logAction("scan_group_completed", { shipping_group_id: group.id, required });
    void printPreIssuedLabel(group, printWindow);
  }

  /** Marks a shipping group as reprintable when its label was already issued. */
  function offerReprint(groupId: string | null | undefined): ShippingGroupRow | null {
    if (!groupId) return null;
    const g = groupById.get(groupId) ?? null;
    if (!g || g.label_status !== "ready" || !g.label_url) return null;
    setReprintGroup(g);
    return g;
  }



  // Prints the waybill that was issued BEFORE packing started. No carrier API here.
  async function printPreIssuedLabel(group: ShippingGroupRow, printWindow?: Window | null) {
    if (group.label_status !== "ready" || !group.label_url) {
      printWindow?.close();
      scanFail();
      setFeedback({ kind: "notfound", msg: tr("송장 미발급 · 먼저 송장 사전발행을 진행하세요", "运单未发行 · 请先执行运单预发行") });
      toast({
        variant: "destructive",
        title: tr("송장 미발급", "运单未发行"),
        description: tr("이 발송건은 아직 송장이 준비되지 않았습니다. 먼저 송장 사전발행을 진행해주세요.",
                        "该发货件尚未准备运单，请先执行运单预发行。"),
      });
      void logAction("label_print_failed", { shipping_group_id: group.id, reason: "label_not_ready" });
      return;
    }
    const url = labelCacheRef.current.get(group.id) ?? group.label_url;
    const carrierCode = group.carrier || carrier || shipmentCarrier;
    perfMark("LABEL_READY");
    void logAction("label_print_requested", { shipping_group_id: group.id, tracking_number: group.tracking_number });

    // 1) Local printer agent — silent, borderless, 100% actual size, original PDF.
    if (await sendToPrintAgent({ url, carrierCode, trackingNumber: group.tracking_number, refNo: (group as any).ref_no })) {
      printWindow?.close();
      perfMark("print_called");
      void supabase.from("shipping_groups").update({ printed_at: new Date().toISOString() }).eq("id", group.id);
      void logAction("label_print_success", { shipping_group_id: group.id, tracking_number: group.tracking_number, via: "agent" });
      return;
    }

    // 2) Fallback — browser print dialog.
    const size = labelSizeFor(carrierCode);
    const w = printWindow ?? window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) {
      toast({ variant: "destructive", title: tr("팝업이 차단되었습니다", "弹窗被拦截") });
      void logAction("label_print_failed", { shipping_group_id: group.id, reason: "popup_blocked" });
      return;
    }
    w.document.write(buildRemoteLabelHtml(url, carrierCode));
    w.document.close();
    perfMark("label_html_written");
    void supabase.from("shipping_groups").update({ printed_at: new Date().toISOString() }).eq("id", group.id);
    void logAction("label_print_success", { shipping_group_id: group.id, tracking_number: group.tracking_number, via: "browser" });
  }


  // ---- Pre-issue (before packing starts) ------------------------------------
  async function runPreIssue() {
    if (!carrier) {
      toast({ variant: "destructive", title: tr("택배사를 선택하세요", "请选择承运商") });
      return;
    }
    const targets = pendingGroups.map((g) => ({ id: g.id, recipient_name: g.recipient_name }));
    if (!targets.length) {
      toast({ title: tr("이미 모든 발송건의 송장이 발급되었습니다", "所有发货件的运单均已发行") });
      setPreIssueOpen(false);
      return;
    }
    setPreIssueRunning(true);
    setPreIssueLog([]);
    setPreIssueProgress({ done: 0, total: targets.length, success: 0, failed: 0 });
    await logAction("label_preissue_started", { count: targets.length, carrier });
    const startedAt = performance.now();
    await issueGroupLabels(targets, carrier, {
      concurrency: 6,
      onProgress: (p) => {
        setPreIssueProgress({ done: p.done, total: p.total, success: p.success, failed: p.failed });
        if (p.last) setPreIssueLog((prev) => [{ name: p.last!.name, ok: p.last!.ok, message: p.last!.message }, ...prev].slice(0, 200));
      },
    });
    setPreIssueRunning(false);
    await refetchGroups();
    await logAction("label_preissue_finished", { count: targets.length, elapsed_ms: Math.round(performance.now() - startedAt) });
  }

  async function retryGroupLabel(group: ShippingGroupRow) {
    if (!carrier) return;
    try {
      await issueGroupLabel(group.id, carrier);
      toast({ title: tr("송장이 발급되었습니다", "已生成运单"), description: group.recipient_name });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("발급 실패", "生成失败"), description: e?.message });
    }
    refetchGroups();
  }



  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = scanInput;
      setScanInput("");
      if (v.trim()) {
        perfStart();
        // Barcode scanners finish with Enter. Open the print target synchronously
        // while that user activation is still valid; opening it after API/database
        // awaits is blocked by Chrome and the carrier label never reaches print.
        const size = labelSizeFor(carrier || shipmentCarrier || "4PX");
        const printWindow = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
        if (printWindow) {
          printWindow.document.write(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">${tr("송장을 생성하고 있습니다…", "正在生成运单…")}</body></html>`);
          printWindow.document.close();
        }
        void handleScan(v, printWindow);
      }
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
  async function issueTrackingViaApi(printWindow?: Window | null, itemPosition?: number) {
    if (!shipment) { printWindow?.close(); return; }
    if (!carrier) {
      printWindow?.close();
      toast({ variant: "destructive", title: tr("택배사를 선택하세요", "请选择承运商") });
      return;
    }
    setIssuing(true);
    const edgeStart = perfRef.current.t0 ? performance.now() - perfRef.current.t0 : 0;
    perfMark("edge_call_start", edgeStart);
    try {
      const res = await requestCarrierLabel(shipment.id, carrier, testMode, testVariant, itemPosition ?? shipRecipientPos);
      // Server-side phase marks are relative to the edge function start.
      for (const t of ((res as any)?.timings ?? []) as { step: string; ms: number }[]) {
        perfMark(t.step, edgeStart + t.ms);
      }
      perfMark("edge_response");
      if (testMode) {
        await logAction("issue_tracking_test", { trackingNumber: res.tracking_number, carrier, via: "api-test", variant: testVariant });
        const cancelled = (res as any)?.cancelled;
        toast({
          title: cancelled === false
            ? tr("운영 테스트 송장 생성됨 · 자동취소 실패", "生产测试运单已生成 · 自动取消失败")
            : tr("운영 테스트 송장 생성 후 취소됨", "生产测试运单已生成并取消"),
          variant: cancelled === false ? "destructive" : undefined,
          description: `${res.tracking_number}${(res as any)?.message ? ` · ${(res as any).message}` : ""}`,
        });
        const url = (res as any)?.label_url as string | undefined;
        setTestLabelUrl(url ?? null);
        if (url) {
          const sentToAgent = await sendToPrintAgent({ url, carrierCode: carrier || shipmentCarrier, trackingNumber: res.tracking_number, refNo: (res as any)?.ref_no });
          if (sentToAgent) { printWindow?.close(); perfMark("print_called"); }
          else {
            const size = labelSizeFor(carrier || shipmentCarrier);
            const w = printWindow ?? window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
            if (w) { w.document.write(buildRemoteLabelHtml(url, carrier || shipmentCarrier)); w.document.close(); perfMark("label_html_written"); }
          }
        } else {
          const why = (res as any)?.message as string | undefined;
          printWindow?.close();
          toast({
            variant: "destructive",
            title: tr("4PX 공식 송장(PDF)을 받지 못해 출력을 중단했습니다", "未获取到4PX官方面单(PDF)，已中止打印"),
            description: tr(
              `임의 출력은 하지 않습니다. ${why ?? "ds.xms.label.get 응답 없음"}`,
              `不会输出任何模拟面单。${why ?? "ds.xms.label.get 无响应"}`,
            ),
          });
        }




        return;
      }
      await logAction("issue_tracking", { trackingNumber: res.tracking_number, carrier, via: "api" });
      // Store the waybill on the scanned parcel row so each item shows only its own tracking number.
      const pos = itemPosition ?? shipRecipientPos;
      if (res.tracking_number && pos) {
        await supabase
          .from("shipment_scan_items")
          .update({
            carrier,
            tracking_number: res.tracking_number,
            label_url: (res as any)?.label_url ?? null,
            tracking_issued_at: new Date().toISOString(),
          } as any)
          .eq("shipment_id", shipment.id)
          .eq("position", pos);
      }
      toast({ title: tr("송장이 발급되었습니다", "已生成运单"), description: res.tracking_number });

      // Auto-print the carrier-issued waybill right after issuance.
      const liveUrl = (res as any)?.label_url as string | undefined;
      if (liveUrl) {
        const sentToAgent = await sendToPrintAgent({ url: liveUrl, carrierCode: carrier || shipmentCarrier, trackingNumber: res.tracking_number, refNo: (res as any)?.ref_no });
        if (sentToAgent) { printWindow?.close(); perfMark("print_called"); }
        else {
          const size = labelSizeFor(carrier || shipmentCarrier);
          const w = printWindow ?? window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
          if (w) { w.document.write(buildRemoteLabelHtml(liveUrl, carrier || shipmentCarrier)); w.document.close(); perfMark("label_html_written"); }
        }
      } else {
        printWindow?.close();
        toast({
          variant: "destructive",
          title: tr("공식 송장 파일이 없어 출력을 중단했습니다", "无官方面单文件，已中止打印"),
          description: tr("택배사에서 송장(PDF)을 받지 못했습니다. 임의 출력은 하지 않습니다.", "未从承运商获取面单(PDF)，不会输出模拟面单。"),
        });
      }

      qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });

    } catch (e: any) {
      printWindow?.close();
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
      // Full reset: scan state AND pre-issued waybill data.
      .update({
        qr_value: null,
        is_scanned: false,
        scanned_at: null,
        scanned_by: null,
        carrier: null,
        tracking_number: null,
        label_url: null,
        tracking_issued_at: null,
      } as any)
      .eq("shipment_id", shipment.id);
    const groupIds = groups.map((g) => g.id);
    if (groupIds.length) {
      await supabase
        .from("shipping_groups")
        .update({
          scanned_count: 0,
          scan_status: "pending",
          printed_at: null,
          carrier: null,
          tracking_number: null,
          label_url: null,
          label_status: "pending",
          label_error: null,
          label_issued_at: null,
        } as any)
        .in("id", groupIds);
    }
    const { error: e2 } = await supabase
      .from("shipments")
      .update({
        scanned_count: 0,
        scan_status: "pending",
        status: "pending",
        shipped_at: null,
        reported_at: null,
        design_confirmed: false,
        // carrier is NOT NULL on shipments — keep the existing carrier code.
        tracking_number: null,
        label_url: null,
        tracking_issued_at: null,
      } as any)
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
    qc.invalidateQueries({ queryKey: ["shipping_groups"] });

  }

  // Label geometry per carrier. 4PX ships 100×150mm (10×15cm) labels.
  function labelSizeFor(code?: string | null) {
    const c = (code ?? "").toLowerCase();
    if (c === "4px") return { w: 100, h: 150 };
    return { w: 70, h: 130 };
  }

  function buildLabelHtml(opts: { test?: boolean; testTracking?: string; noPrint?: boolean; scale?: number } = {}) {
    // `test` = fixed dummy recipient (printer check).
    // `testTracking` = real order data, simulated tracking number (4PX test mode).
    const test = !!opts.test;
    const simulated = !!opts.testTracking;
    const carrierCode = test ? TEST_RECIPIENT.carrier : (shipmentCarrier || carrier || "");
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
              name: shipRecipient.name,
              phone: shipRecipient.phone,
              street: shipRecipient.address,
              city: shipRecipient.city,
              state: shipRecipient.state,
              zip: shipRecipient.zip,
              country: shipRecipient.country,
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
      { print: !opts.noPrint, scale: opts.scale ?? (opts.noPrint ? 100 : labelScale) },
    );
  }


  // Carrier-issued waybill (4PX ds.xms.label.get), printed at 100 % actual size.
  // The 4PX file is a vector PDF: it is embedded as-is (no PNG/JPG/canvas conversion,
  // no CSS scale/zoom/fit) so the printer receives the original resolution.
  function buildRemoteLabelHtml(url: string, code?: string | null, noPrint = false) {
    const { w: LW, h: LH } = labelSizeFor(code);
    const secureUrl = url.replace(/^http:\/\/bss-fss\.4px\.com\//i, "https://bss-fss.4px.com/");
    const isImg = /^data:image\//i.test(secureUrl) || /\.(png|jpe?g)$/i.test(secureUrl);
    const isHtml = /^data:text\/html/i.test(secureUrl) || /\.html?$/i.test(secureUrl);
    const isPdf = !isImg && !isHtml;
    // PDF keeps its native geometry (scale = 1). Only raster/HTML labels may use the
    // driver-compensation scale, since those have no embedded page size of their own.
    const k = noPrint || isPdf ? 1 : Math.min(3, Math.max(0.5, labelScale / 100));
    const PW = +(LW * k).toFixed(3);
    const PH = +(LH * k).toFixed(3);

    // eslint-disable-next-line no-console
    console.log("[label] source", {
      kind: isPdf ? "pdf" : isImg ? "image" : "html",
      page_mm: `${PW}x${PH}`,
      media_mm: `${LW}x${LH}`,
      css_scale: k,
      bytes: /^data:/.test(secureUrl) ? Math.round(((secureUrl.split(",")[1] ?? "").length * 3) / 4) : null,
      url: /^data:/.test(secureUrl) ? `${secureUrl.slice(0, 40)}...` : secureUrl,
    });

    const printScript = noPrint
      ? ""
      : `<script>
          let printStarted=false;
          function report(step){try{if(window.opener)window.opener.postMessage({type:"label-timing",step:step},"*");}catch(e){}}
          function logSize(){
            try{
              var el=document.querySelector("img,iframe");
              console.log("[label] before print",{
                media_mm:"${LW}x${LH}",
                page_mm:"${PW}x${PH}",
                css_scale:${k},
                element_px:el?el.getBoundingClientRect().width.toFixed(1)+"x"+el.getBoundingClientRect().height.toFixed(1):null,
                natural_px:(el&&el.naturalWidth)?el.naturalWidth+"x"+el.naturalHeight:"vector/pdf",
                dpr:window.devicePixelRatio
              });
            }catch(e){}
          }
          function printCarrierLabel(){
            if(printStarted)return;
            printStarted=true;
            report("label_loaded");
            window.focus();
            logSize();
            requestAnimationFrame(()=>setTimeout(()=>{
              report("print_called");
              window.print();
              window.onafterprint=()=>window.close();
            },60));
          }
          window.addEventListener("afterprint",()=>window.close());
          setTimeout(printCarrierLabel,2500);
        <\/script>`;

    const body = isImg
      ? `<img src="${secureUrl}" ${noPrint ? "" : 'onload="printCarrierLabel()"'}/>`
      : isHtml
        ? `<iframe src="${secureUrl}" frameborder="0" ${noPrint ? "" : 'onload="printCarrierLabel()"'}></iframe>`
        : `<iframe src="${secureUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit&zoom=100" type="application/pdf" frameborder="0" ${noPrint ? "" : 'onload="printCarrierLabel()"'}></iframe>`;
    // PDF: exact 100×150 mm media, no transform / zoom / object-fit (100 % actual size).
    const media = isPdf
      ? `img, iframe { width: ${LW}mm; height: ${LH}mm; display: block; border: 0; }`
      : `img, iframe { width: ${LW}mm; height: ${LH}mm; object-fit: contain; display: block; border: 0; transform: scale(${k}); transform-origin: top left; }`;
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Label</title>
      <style>
        @page { size: ${PW}mm ${PH}mm; margin: 0; }
        html, body { margin: 0; padding: 0; width: ${PW}mm; height: ${PH}mm; overflow: hidden; }
        ${media}
      </style></head><body>
      ${body}${printScript}
      </body></html>`;
  }



  async function downloadLabelPdf() {
    if (!shipment) return;
    const labelUrl = (shipment as any).label_url as string | null | undefined;
    if (labelUrl && await sendToPrintAgent({ url: labelUrl, carrierCode: shipment.carrier || carrier, trackingNumber: shipment.tracking_number })) {
      toast({ title: tr("프린터 에이전트로 전송했습니다", "已发送至打印代理"), description: shipment.tracking_number ?? undefined });
      return;
    }
    const size = labelSizeFor(shipment.carrier || carrier);
    const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(
      labelUrl
        ? buildRemoteLabelHtml(labelUrl, shipment.carrier || carrier)
        : buildLabelHtml(),
    );
    w.document.close();
  }


  async function printTestLabel(printWindow?: Window | null) {
    const size = labelSizeFor(TEST_RECIPIENT.carrier);
    const html = buildLabelHtml({ test: true });
    const sent = await sendHtmlLabelToAgent({
      html,
      size,
      carrierCode: TEST_RECIPIENT.carrier,
      trackingNumber: "TEST-PREVIEW-0000",
    });
    if (sent) {
      printWindow?.close();
      toast({
        title: tr("테스트 송장을 프린터 에이전트로 전송했습니다", "测试运单已发送至打印代理"),
        description: `${size.w}×${size.h}mm · ${agentCfgRef.current.baseUrl}`,
      });
      return;
    }
    const w = printWindow ?? window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(html);
    w.document.close();
    toast({
      title: tr("테스트 송장 출력", "测试运单打印"),
      description: tr(
        `프린터 대화창이 열렸습니다 (${size.w}×${size.h}mm) — 용지 ${size.w}×${size.h}mm, 배율 100%(맞춤 인쇄 해제), 여백 없음으로 설정하세요.`,
        `已打开打印对话框 (${size.w}×${size.h}mm) — 请设置纸张 ${size.w}×${size.h}mm、缩放 100%（关闭适应页面）、无边距。`,
      ),
    });
  }

  // Test-mode label: real order/address data, simulated (non-billable) tracking number.
  async function printSimulatedLabel(trackingNumber: string, printWindow?: Window | null) {
    const size = labelSizeFor(carrier || shipmentCarrier);
    const html = buildLabelHtml({ testTracking: trackingNumber });
    if (await sendHtmlLabelToAgent({ html, size, carrierCode: carrier || shipmentCarrier, trackingNumber })) {
      printWindow?.close();
      return;
    }
    const w = printWindow ?? window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }


  // ── Print calibration ──────────────────────────────────────────────
  // Prints a ruler sheet at the CURRENT scale. The user measures the printed
  // frame with a ruler; the real scale is derived from the difference, which
  // cancels out any hidden driver shrink ("fit to page" / printable-area fit).
  function printCalibrationSheet() {
    const size = labelSizeFor(shipmentCarrier || carrier || "4PX");
    const k = Math.min(3, Math.max(0.5, labelScale / 100));
    const PW = +(size.w * k).toFixed(3);
    const PH = +(size.h * k).toFixed(3);
    const ticks = (len: number, horizontal: boolean) =>
      Array.from({ length: Math.floor(len / 10) + 1 }, (_, i) => {
        const mm = i * 10;
        const long = mm % 50 === 0;
        return horizontal
          ? `<div style="position:absolute;left:${mm}mm;top:0;width:0.3mm;height:${long ? 8 : 4}mm;background:#000"></div>
             ${long ? `<div style="position:absolute;left:${mm + 1}mm;top:8mm;font-size:7pt">${mm}</div>` : ""}`
          : `<div style="position:absolute;top:${mm}mm;left:0;height:0.3mm;width:${long ? 8 : 4}mm;background:#000"></div>
             ${long ? `<div style="position:absolute;top:${mm + 1}mm;left:8mm;font-size:7pt">${mm}</div>` : ""}`;
      }).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Calibration</title><style>
      @page { size: ${PW}mm ${PH}mm; margin: 0; }
      html,body{margin:0;padding:0;width:${PW}mm;height:${PH}mm;overflow:hidden;background:#fff;font-family:Arial,sans-serif;color:#000}
      .sheet{width:${size.w}mm;height:${size.h}mm;transform:scale(${k});transform-origin:top left;position:relative;border:0.4mm solid #000}
    </style></head><body>
      <div class="sheet">
        <div style="position:absolute;left:0;top:0;width:${size.w}mm;height:14mm">${ticks(size.w, true)}</div>
        <div style="position:absolute;left:0;top:0;height:${size.h}mm;width:14mm">${ticks(size.h, false)}</div>
        <div style="position:absolute;left:16mm;top:20mm;font-size:9pt;line-height:1.6">
          <div><b>PRINT CALIBRATION</b></div>
          <div>Target: ${size.w} × ${size.h} mm</div>
          <div>App scale: ${labelScale}%</div>
          <div style="margin-top:4mm">가로/세로 실제 인쇄 길이를<br/>자로 재서 앱에 입력하세요.</div>
        </div>
        <div style="position:absolute;left:16mm;top:${Math.round(size.h / 2)}mm;width:${size.w - 32}mm;height:0.4mm;background:#000"></div>
        <div style="position:absolute;left:16mm;top:${Math.round(size.h / 2) + 2}mm;font-size:8pt">↔ ${size.w - 32} mm</div>
      </div>
      <script>window.onload=()=>{setTimeout(()=>window.print(),300)};<\/script>
    </body></html>`;

    const w = window.open("", "_blank", `width=${Math.round(size.w * 4)},height=${Math.round(size.h * 4)}`);
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  function applyCalibration() {
    const size = labelSizeFor(shipmentCarrier || carrier || "4PX");
    const mw = Number(measuredW);
    const mh = Number(measuredH);
    const ratios: number[] = [];
    if (Number.isFinite(mw) && mw > 10) ratios.push(size.w / mw);
    if (Number.isFinite(mh) && mh > 10) ratios.push(size.h / mh);
    if (!ratios.length) {
      toast({ variant: "destructive", title: tr("측정값을 입력하세요", "请输入测量值") });
      return;
    }
    const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const next = Math.min(300, Math.max(50, +(labelScale * ratio).toFixed(1)));
    setLabelScale(next);
    setCalibOpen(false);
    toast({
      title: tr("출력 배율 보정 완료", "打印比例校准完成"),
      description: tr(`${labelScale}% → ${next}% 로 조정했습니다. 다시 테스트 출력해 확인하세요.`, `已从 ${labelScale}% 调整为 ${next}%，请再次测试打印确认。`),
    });
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
        <AlertDescription className="font-medium flex items-center justify-between gap-3">
          <span>{feedback.msg}</span>
          {reprintGroup && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const g = reprintGroup;
                setReprintGroup(null);
                void printPreIssuedLabel(g);
              }}
            >
              <Printer className="w-4 h-4 mr-1" />
              {tr("재인쇄", "重新打印")}
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }, [feedback, reprintGroup]);


  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{tr("불러오는 중...", "加载中...")}</div>;
  if (!shipment) return (
    <div className="p-8 text-center space-y-3">
      <p className="text-muted-foreground">{tr("주문을 찾을 수 없습니다", "找不到订单")}</p>
      <Button variant="outline" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록", "返回")}</Button>
    </div>
  );

  const activeCarrier = carrier || shipmentCarrier || "4px";
  const activeCarrierName = couriers.find((c) => c.code === activeCarrier)?.name ?? activeCarrier.toUpperCase();
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
          <Button size="sm" onClick={() => setPreIssueOpen(true)} disabled={buildingGroups}>
            <Truck className="w-4 h-4 mr-1"/>{tr("송장 사전발행", "运单预发行")}
            <span className="mx-1.5 opacity-70">·</span>
            <span className="text-[11px] font-medium">{activeCarrierName}</span>
            {pendingGroups.length > 0 && (
              <Badge variant="outline" className="ml-2 text-[10px]">{pendingGroups.length}</Badge>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchGroups(); }}><RefreshCw className="w-4 h-4 mr-1"/>{tr("새로고침", "刷新")}</Button>
          <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="w-4 h-4 mr-1"/>{tr("초기화", "重置")}
          </Button>
        </div>
      </div>

      {/* 송장 사전발행 — 확인 / 진행상태 */}
      <Dialog open={preIssueOpen} onOpenChange={(o) => { if (!preIssueRunning) setPreIssueOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("송장을 사전발행하시겠습니까?", "是否预发行运单？")}</DialogTitle>
          </DialogHeader>
          {!preIssueRunning && preIssueProgress.total === 0 ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">{tr("발행 택배사", "发行承运商")}</span>
                <Badge variant="secondary" className="text-xs">{activeCarrierName}</Badge>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tr("전체 제품(주문 항목)", "全部产品(订单项)")}</span><b>{groupMembers.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tr("실제 발송건", "实际发货件")}</span><b>{groups.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tr("1개 발송", "单件发货")}</span><b>{singleGroups.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tr("2개 이상 묶음발송", "2件以上合并发货")}</span><b>{multiGroups.length}</b></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{tr("이미 발급완료", "已发行")}</span><b>{groups.length - pendingGroups.length}</b></div>
              <div className="flex justify-between text-primary"><span>{tr("이번에 새로 발급", "本次新发行")}</span><b>{pendingGroups.length}</b></div>
              <p className="text-[11px] text-muted-foreground pt-2">
                {tr("이미 발급된 송장은 다시 생성되지 않습니다 (중복 발급 방지).", "已发行的运单不会重复生成（防止重复出单）。")}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <Progress value={preIssueProgress.total ? (preIssueProgress.done / preIssueProgress.total) * 100 : 0} />
              <div className="flex items-center justify-between text-sm">
                <span>{preIssueProgress.done} / {preIssueProgress.total} {tr("완료", "完成")}</span>
                <span className="text-xs">
                  <span className="text-emerald-400">{tr("성공", "成功")} {preIssueProgress.success}</span>
                  {" · "}
                  <span className="text-destructive">{tr("실패", "失败")} {preIssueProgress.failed}</span>
                </span>
              </div>
              <ScrollArea className="h-40 border rounded-md p-2">
                {preIssueLog.map((l, i) => (
                  <div key={i} className="text-xs py-0.5 flex items-start gap-2">
                    {l.ok
                      ? <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400 shrink-0"/>
                      : <AlertTriangle className="w-3 h-3 mt-0.5 text-destructive shrink-0"/>}
                    <span className="shrink-0">{l.name}</span>
                    {l.message && (
                      <span className={`break-all ${l.ok ? "text-muted-foreground" : "text-destructive"}`}>· {l.message}</span>
                    )}
                  </div>
                ))}
              </ScrollArea>
              {preIssueLog.some((l) => !l.ok) && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-destructive">
                      {tr("실패 상세", "失败详情")} ({preIssueLog.filter((l) => !l.ok).length})
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      onClick={() => {
                        const text = preIssueLog.filter((l) => !l.ok).map((l) => `${l.name}\t${l.message ?? ""}`).join("\n");
                        void navigator.clipboard.writeText(text);
                        toast({ title: tr("실패 내용을 복사했습니다", "已复制失败内容") });
                      }}
                    >
                      {tr("복사", "复制")}
                    </Button>
                  </div>
                  <ScrollArea className="h-28 border border-destructive/40 rounded-md p-2 bg-destructive/5">
                    {preIssueLog.filter((l) => !l.ok).map((l, i) => (
                      <div key={i} className="text-[11px] py-1 border-b border-border/40 last:border-0">
                        <div className="font-medium">{l.name}</div>
                        <div className="text-destructive break-all whitespace-pre-wrap">{l.message ?? tr("알 수 없는 오류", "未知错误")}</div>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              )}

            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={preIssueRunning} onClick={() => { setPreIssueOpen(false); setPreIssueProgress({ done: 0, total: 0, success: 0, failed: 0 }); }}>
              {tr("닫기", "关闭")}
            </Button>
            <Button disabled={preIssueRunning || pendingGroups.length === 0} onClick={runPreIssue}>
              {preIssueRunning ? tr("발행 중...", "发行中...") : tr("송장 사전발행", "运单预发行")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 현재 작업 중인 발송 그룹 */}
      {(() => {
        const g = activeGroupId ? groupById.get(activeGroupId) : undefined;
        if (!g) return null;
        const required = g.required_scan_count || g.item_count || 1;
        const done = Math.min(g.scanned_count ?? 0, required);
        const complete = done >= required;
        return (
          <Card className={complete ? "border-emerald-500/50 bg-emerald-500/5" : "border-primary/40"}>
            <CardContent className="p-4 flex flex-wrap items-center gap-6">
              <div>
                <div className="text-xs text-muted-foreground">{tr("현재 작업", "当前作业")}</div>
                <div className="text-xl font-semibold">{g.recipient_name}</div>
                <div className="text-xs text-muted-foreground">{[g.shipping_city, g.shipping_state].filter(Boolean).join(", ")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr("총 제품수량", "总产品数")}</div>
                <div className="text-xl font-semibold">{g.item_count}{tr("개", "件")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{tr("스캔", "扫码")}</div>
                <div className="text-3xl font-bold tabular-nums">{done} / {required}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: required }).map((_, i) => (
                  <span key={i} className={`w-4 h-4 rounded-full border ${i < done ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/40"}`} />
                ))}
              </div>
              <div className="ml-auto text-right">
                {complete ? (
                  <div className="text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4"/>{tr("모든 제품 확인 완료 · 송장 출력", "全部产品确认完成 · 打印运单")}
                  </div>
                ) : (
                  <div className="text-amber-400 font-medium">
                    {tr(`${required - done}개 더 스캔하세요`, `还需扫描 ${required - done} 件`)}
                  </div>
                )}
                <div className="text-xs font-mono text-muted-foreground">{g.tracking_number ?? tr("송장 미발급", "运单未发行")}</div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("스캔 작업 초기화", "重置扫码作业")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {tr("스캔 기록과 진행 상태는 물론, 사전발급된 송장 정보(운송장 번호·라벨)까지 모두 초기화됩니다. 다시 작업하려면 송장을 재발행해야 합니다.",
                "扫码记录、进度以及已预先发行的运单信息（运单号·面单）将全部重置，需要重新发行运单。")}

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
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("수취인", "收件人")}</span><span>{shipRecipient.name || "-"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("전화", "电话")}</span><span className="font-mono text-xs">{shipRecipient.phone || "-"}</span></div>
            <div className="text-muted-foreground pt-1">{tr("주소", "地址")}</div>
            <div className="text-xs">{[shipRecipient.address, shipRecipient.city, shipRecipient.state, shipRecipient.zip].filter(Boolean).join(", ")}</div>
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

      {/* 발송건(그룹) 목록 — 전체 / 1건 주문 / 2개 이상 주문 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4" />
            {tr("주소록 · 발송건 목록", "地址簿 · 发货件列表")}
            {buildingGroups && <span className="text-[11px] text-muted-foreground">{tr("그룹 계산 중…", "分组计算中…")}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={groupTab} onValueChange={(v) => setGroupTab(v as any)}>
            <TabsList>
              <TabsTrigger value="all">{tr("전체", "全部")} <Badge variant="outline" className="ml-2 text-[10px]">{groups.length}</Badge></TabsTrigger>
              <TabsTrigger value="single">{tr("1건 주문", "单件订单")} <Badge variant="outline" className="ml-2 text-[10px]">{singleGroups.length}</Badge></TabsTrigger>
              <TabsTrigger value="multi">{tr("2개 이상 주문", "2件以上订单")} <Badge variant="outline" className="ml-2 text-[10px]">{multiGroups.length}</Badge></TabsTrigger>
            </TabsList>
          </Tabs>

          <ScrollArea className="h-[420px] border rounded-md">
            <div className="divide-y">
              {(groupTab === "single" ? singleGroups : groupTab === "multi" ? multiGroups : groups).map((g) => {
                const members = membersByGroup.get(g.id) ?? [];
                const required = g.required_scan_count || g.item_count || 1;
                const done = members.filter((m: any) => m.is_scanned).length;
                const open = !!expandedGroups[g.id];
                const statusBadge =
                  g.label_status === "ready"
                    ? <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{tr("발급완료", "已发行")}</Badge>
                    : g.label_status === "issuing"
                    ? <Badge variant="outline" className="text-[10px] bg-blue-500/15 text-blue-400 border-blue-500/30">{tr("발급중", "发行中")}</Badge>
                    : g.label_status === "failed"
                    ? <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">{tr("발급실패", "发行失败")}</Badge>
                    : <Badge variant="outline" className="text-[10px]">{tr("미발급", "未发行")}</Badge>;
                return (
                  <div key={g.id} className="text-sm">
                    <button
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent/30 text-left"
                      onClick={() => setExpandedGroups((prev) => ({ ...prev, [g.id]: !open }))}
                    >
                      {open ? <ChevronDown className="w-4 h-4 shrink-0"/> : <ChevronRight className="w-4 h-4 shrink-0"/>}
                      <div className="min-w-[160px]">
                        <div className="font-medium">{g.recipient_name || "-"}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[240px]" title={g.shipping_address}>
                          {[g.shipping_city, g.shipping_state, g.shipping_zip].filter(Boolean).join(", ")}
                        </div>
                      </div>
                      <div className="text-xs w-24">{tr("제품수량", "产品数")} <b>{g.item_count}</b></div>
                      <div className="text-xs w-24">{tr("스캔", "扫码")} <b className={done >= required ? "text-emerald-400" : ""}>{done} / {required}</b></div>
                      <div className="w-24">{statusBadge}</div>
                      <div className="font-mono text-xs flex-1 truncate">{g.tracking_number ?? "-"}</div>
                      {g.label_status === "failed" && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="text-xs underline text-destructive"
                          onClick={(e) => { e.stopPropagation(); void retryGroupLabel(g); }}
                        >
                          {tr("재시도", "重试")}
                        </span>
                      )}
                    </button>
                    {open && (
                      <div className="px-10 pb-3 space-y-1">
                        {g.label_error && <div className="text-[11px] text-destructive">{g.label_error}</div>}
                        <div className="text-[11px] text-muted-foreground">
                          {g.shipping_address} · {g.recipient_phone} · {g.shipping_country}
                          {g.label_issued_at && ` · ${tr("발급", "发行")} ${new Date(g.label_issued_at).toLocaleString()}`}
                        </div>
                        {members.map((m: any) => (
                          <div key={m.id} className="flex items-center gap-3 text-xs py-0.5">
                            <span className="font-mono text-muted-foreground w-40 truncate">{m.orders?.external_order_id ?? "-"} #{m.position}</span>
                            <span className="font-mono truncate max-w-[200px]">{m.qr_value ?? "-"}</span>
                            {m.is_scanned
                              ? <span className="text-emerald-400">✓ {tr("스캔완료", "已扫描")}</span>
                              : <span className="text-muted-foreground">{tr("미스캔", "未扫描")}</span>}
                          </div>
                        ))}
                        <div className="text-xs pt-1">{tr("진행상태", "进度")} <b>{done} / {required}</b></div>
                      </div>
                    )}
                  </div>
                );
              })}
              {groups.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-10">
                  {tr("발송건이 없습니다. 새로고침하거나 주문 데이터를 확인해 주세요.", "暂无发货件，请刷新或检查订单数据。")}
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

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
                  <th className="text-left px-3 py-2">{tr("수취인명", "收件人")}</th>
                  <th className="text-left px-3 py-2">{tr("전화", "电话")}</th>
                  <th className="text-left px-3 py-2">{tr("주소", "地址")}</th>
                  <th className="text-left px-3 py-2">{tr("우편번호", "邮编")}</th>
                  <th className="text-left px-3 py-2">{tr("국가", "国家")}</th>
                  <th className="text-center px-3 py-2">{tr("스캔", "扫码")}</th>
                  <th className="text-left px-3 py-2">{tr("택배사", "承运商")}</th>
                  <th className="text-left px-3 py-2">{tr("송장번호", "运单号")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: any) => {
                  const holo = it.qr_value ? holoSerials[it.qr_value] : undefined;
                  const holoNo = holoUniqueNos[(it.position ?? 1) - 1] || holo?.serial || "-";
                  const src: any[] = Array.isArray(order?.source_data?.items) ? order.source_data.items : [];
                  const si: any = src[(it.position ?? 1) - 1] || {};
                  const productCode = it.product_code || si.tshirt_type || order?.product_code || "";
                  const color = it.color || si.tshirt_color || "";
                  const size = it.size || si.tshirt_size || "";
                  const recipient = si.recipient_name || "-";
                  const phone = si.recipient_phone || "-";
                  const address = si.shipping_address || order?.shipping_address || "";
                  const zip = si.shipping_zip || order?.shipping_zip || "-";
                  const country = si.country_code || order?.shipping_country || "-";
                  return (
                    <tr key={it.id} className="border-b hover:bg-accent/30 transition-colors">
                      <td className="px-3 py-2 text-center font-mono text-xs">{it.position}</td>
                      <td className="px-3 py-2 font-mono text-xs">{holoNo}</td>
                      <td className="px-3 py-2 font-mono text-xs max-w-[180px] truncate" title={it.qr_value ?? ""}>{it.qr_value ?? "-"}</td>
                      <td className="px-3 py-2 text-xs">
                        {[productCode, color, size].filter(Boolean).join(" / ") || "-"}
                      </td>
                      <td className="px-3 py-2 font-medium">{recipient}</td>
                      <td className="px-3 py-2 font-mono text-xs">{phone}</td>
                      <td className="px-3 py-2 text-xs max-w-[240px] truncate" title={address}>{address || "-"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{zip}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{country}</td>

                      <td className="px-3 py-2 text-center">
                        {it.is_scanned
                          ? <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">OK</Badge>
                          : <Badge variant="outline" className="text-[10px]">{tr("대기", "待扫")}</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs uppercase">{(it.carrier ?? "-") as string}</td>
                      <td className="px-3 py-2 font-mono text-xs">{it.tracking_number ?? "-"}</td>

                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr><td colSpan={12} className="text-center text-xs text-muted-foreground py-8">
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
                  `사진처럼 전체 내용이 약 75%로 축소되면 4PX 원본 문제가 아니라 브라우저 또는 프린터 드라이버가 용지에 맞춰 다시 축소한 상태입니다. 용지 ${previewSize.w}×${previewSize.h}mm, 브라우저 배율 100%, 여백 없음, 프린터 환경설정의 실제 크기/배율 100%를 확인한 뒤 아래 보정을 사용하세요.`,
                  `若像照片一样整体缩小至约 75%，并非 4PX 原稿问题，而是浏览器或打印机驱动再次进行了适应纸张缩放。请确认纸张 ${previewSize.w}×${previewSize.h}mm、浏览器比例 100%、无边距以及打印机首选项中的实际大小/比例 100%，然后使用下方校准。`
                )}
              </AlertDescription>
            </Alert>

            {/* Local printer agent (http://127.0.0.1:9100) */}
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  <span className="font-medium text-xs">{tr("프린터 에이전트 직접 출력", "打印代理直接输出")}</span>
                  <Badge variant={agentOnline ? "default" : agentCfg.enabled ? "destructive" : "secondary"} className="text-[10px]">
                    {!agentCfg.enabled
                      ? tr("사용 안 함", "未启用")
                      : agentOnline === null
                        ? tr("확인 중", "检测中")
                        : agentOnline
                          ? tr("연결됨", "已连接")
                          : tr("미설치/오프라인", "未安装/离线")}
                  </Badge>
                </div>
                <Switch
                  checked={agentCfg.enabled}
                  onCheckedChange={(v) => void persistAgentCfg({ ...agentCfg, enabled: v })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{tr("에이전트 주소", "代理地址")}</Label>
                  <Input
                    className="h-8 text-xs font-mono"
                    value={agentCfg.baseUrl}
                    onChange={(e) => void persistAgentCfg({ ...agentCfg, baseUrl: e.target.value })}
                    placeholder="http://127.0.0.1:9100"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">{tr("프린터 이름(선택)", "打印机名称（可选）")}</Label>
                  <Input
                    className="h-8 text-xs font-mono"
                    value={agentCfg.printerName}
                    onChange={(e) => void persistAgentCfg({ ...agentCfg, printerName: e.target.value })}
                    placeholder="ALP203"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const ok = await checkPrintAgent(agentCfg.baseUrl);
                    setAgentOnline(ok);
                    toast({
                      variant: ok ? undefined : "destructive",
                      title: ok ? tr("에이전트 연결 정상", "代理连接正常") : tr("에이전트에 연결할 수 없습니다", "无法连接打印代理"),
                      description: ok
                        ? agentCfg.baseUrl
                        : tr("에이전트 실행 여부와 CORS 허용 설정을 확인하세요.", "请确认代理已运行且允许 CORS。"),
                    });
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-1" />{tr("연결 확인", "连接检测")}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {tr("스캔 시 원본 PDF를 에이전트로 직접 전송합니다(여백 0 · 100% · 세로). 실패하면 브라우저 인쇄로 자동 전환됩니다.",
                      "扫描时将原始 PDF 直接发送至代理（无边距 · 100% · 纵向）。失败时自动切换为浏览器打印。")}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void printTestLabel()}>
                <TestTube2 className="w-4 h-4 mr-1" />{tr("테스트 출력", "测试打印")}
              </Button>
              <Button variant="outline" disabled={!shipment.tracking_number} onClick={downloadLabelPdf}>
                <Printer className="w-4 h-4 mr-1" />{tr("실제 송장 출력", "打印当前运单")}
              </Button>
              <Button variant="secondary" onClick={() => setCalibOpen(true)}>
                <RefreshCw className="w-4 h-4 mr-1" />{tr("배율 보정", "比例校准")}
              </Button>
              <div className="flex items-center gap-1 rounded-md border px-2 py-1">
                <span className="text-[11px] text-muted-foreground">{tr("출력 배율", "打印比例")}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => setLabelScale((v) => Math.max(50, +(v - 1).toFixed(1)))}>−</Button>
                <Input
                  type="number"
                  min={50}
                  max={300}
                  step={0.5}
                  value={labelScale}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setLabelScale(Math.min(300, Math.max(50, v)));
                  }}
                  className="h-7 w-16 text-center font-mono text-xs"
                />
                <span className="text-[11px] text-muted-foreground">%</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => setLabelScale((v) => Math.min(300, +(v + 1).toFixed(1)))}>+</Button>
              </div>
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

      {/* Print-scale calibration */}
      <Dialog open={calibOpen} onOpenChange={setCalibOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr("출력 배율 보정", "打印比例校准")}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              {tr(
                `1) 아래 ‘눈금자 시트 출력’을 눌러 인쇄합니다(현재 배율 ${labelScale}%).\n2) 인쇄된 테두리의 가로·세로 실제 길이를 자로 재서 입력합니다.\n3) 적용을 누르면 ${previewSize.w}×${previewSize.h}mm 로 나오도록 배율이 자동 계산됩니다.`,
                `1) 点击下方「打印标尺页」（当前比例 ${labelScale}%）。\n2) 用尺子测量打印边框的实际长宽并输入。\n3) 点击应用后自动计算为 ${previewSize.w}×${previewSize.h}mm 的比例。`
              )}
            </p>
            <Button variant="outline" size="sm" onClick={printCalibrationSheet}>
              <Printer className="w-4 h-4 mr-1" />{tr("눈금자 시트 출력", "打印标尺页")}
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{tr(`실측 가로 (mm) · 목표 ${previewSize.w}`, `实测宽度 (mm) · 目标 ${previewSize.w}`)}</Label>
                <Input type="number" step={0.5} value={measuredW} onChange={(e) => setMeasuredW(e.target.value)} placeholder="75" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tr(`실측 세로 (mm) · 목표 ${previewSize.h}`, `实测高度 (mm) · 目标 ${previewSize.h}`)}</Label>
                <Input type="number" step={0.5} value={measuredH} onChange={(e) => setMeasuredH(e.target.value)} placeholder="110" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCalibOpen(false)}>{tr("취소", "取消")}</Button>
            <Button onClick={applyCalibration}>{tr("적용", "应用")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

}

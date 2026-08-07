import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQrMasterData } from "@/hooks/useQrMasterData";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ScanLine, CheckCircle2, XCircle, Clock, AlertTriangle,
  Image, Sticker, QrCode, Hash, Shirt, RotateCcw, Loader2,
  ChevronRight, Package, ChevronLeft, List, Play
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import WorkCamRecorder from "@/components/WorkCamRecorder";


type StepStatus = "waiting" | "scanning" | "pass" | "fail";

interface WorkItem {
  seq: number;
  orderIdNo: string;
  color: string;
  size: string;
  siliconQR: string;
  designQR: string;
  hologramQR: string;
  tshirtSerial: string;
  logoUrl?: string | null;
  designUrl?: string | null;
  twincodeUrl?: string | null;
  status: "pending" | "done" | "fail";
}

interface OrderData {
  id: string;
  orderNo: string;
  externalOrderId: string;
  twinker: string;
  product: string;
  design: string;
  orderDate: string;
  dueDate: string;
  items: WorkItem[];
  logoUrl: string | null;
  uploadHistoryId: string | null;
  designCode: string;
}

// QR lookup tables loaded from DB via hook (see below in component)

// Convert Korean Hangul jamo (typed with IME on) back to QWERTY equivalents.
const HANGUL_JAMO_MAP: Record<string, string> = {
  "ㅂ":"q","ㅈ":"w","ㄷ":"e","ㄱ":"r","ㅅ":"t","ㅛ":"y","ㅕ":"u","ㅑ":"i","ㅐ":"o","ㅔ":"p",
  "ㅁ":"a","ㄴ":"s","ㅇ":"d","ㄹ":"f","ㅎ":"g","ㅗ":"h","ㅓ":"j","ㅏ":"k","ㅣ":"l",
  "ㅋ":"z","ㅌ":"x","ㅊ":"c","ㅍ":"v","ㅠ":"b","ㅜ":"n","ㅡ":"m",
  "ㅃ":"Q","ㅉ":"W","ㄸ":"E","ㄲ":"R","ㅆ":"T","ㅒ":"O","ㅖ":"P",
};
// Decompose precomposed Hangul syllables (가-힣) into initial+medial+final jamo, then map.
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const JUNG = ["ㅏ","ㅐ","ㅑ","ㅒ","ㅓ","ㅔ","ㅕ","ㅖ","ㅗ","ㅘ","ㅙ","ㅚ","ㅛ","ㅜ","ㅝ","ㅞ","ㅟ","ㅠ","ㅡ","ㅢ","ㅣ"];
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function hangulToQwerty(input: string): string {
  if (!input) return input;
  let hasHangul = false;
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      hasHangul = true;
      const s = code - 0xAC00;
      const cho = CHO[Math.floor(s / 588)];
      const jung = JUNG[Math.floor((s % 588) / 28)];
      const jong = JONG[s % 28];
      for (const j of [cho, jung, jong]) {
        if (!j) continue;
        for (const k of j) out += HANGUL_JAMO_MAP[k] ?? k;
      }
    } else if (HANGUL_JAMO_MAP[ch] !== undefined) {
      hasHangul = true;
      out += HANGUL_JAMO_MAP[ch];
    } else {
      out += ch;
    }
  }
  return hasHangul ? out : input;
}

function ProgressBar({ done, total, fail, defectLabel }: { done: number; total: number; fail: number; defectLabel: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isComplete = done >= total;
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${isComplete ? "bg-[hsl(var(--success))]" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-16 text-right">{done}/{total}</span>
      {fail > 0 && <span className="text-xs tabular-nums text-destructive">({fail}{defectLabel})</span>}
    </div>
  );
}

function PriorityBadge({ priority, t }: { priority: string; t: (k: string) => string }) {
  const label = priority === "high" ? t("tshirtWork.priorityHigh") : priority === "medium" ? t("tshirtWork.priorityMedium") : t("tshirtWork.priorityLow");
  const cls = priority === "high" ? "bg-destructive/10 text-destructive" : priority === "medium" ? "bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning))]" : "bg-muted text-muted-foreground";
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function StatusBadge({ status, t }: { status: WorkItem["status"]; t: (k: string) => string }) {
  if (status === "done") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">{t("tshirtWork.completed")}</span>;
  if (status === "fail") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">{t("tshirtWork.defects")}</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t("tshirtWork.pending")}</span>;
}

export default function TshirtWork() {
  const { t, lang } = useLang();
  const isKo = lang === "ko";
  const { tshirtQR: mockTshirtQR, siliconQR: mockSiliconQR, designQR: mockDesignQR, holoQR: mockHoloQR } = useQrMasterData();

  // Scan order: 마크고유번호(-1) → 티셔츠 → 디자인 고유번호(-2) → 스티커 고유번호(-3)
  const steps = [
    { key: "mark", label: isKo ? "마크 고유번호" : "标识唯一编号", icon: Sticker, placeholder: isKo ? "마크 고유번호(-1)를 스캔하세요" : "请扫描标识唯一编号(-1)" },
    { key: "tshirt", label: t("tshirtWork.tshirtScan"), icon: Shirt, placeholder: isKo ? "티셔츠 QR을 스캔하세요" : "请扫描T恤QR" },
    { key: "design", label: isKo ? "디자인 고유번호" : "设计唯一编号", icon: QrCode, placeholder: isKo ? "디자인 고유번호(-2)를 스캔하세요" : "请扫描设计唯一编号(-2)" },
    { key: "sticker", label: isKo ? "스티커 고유번호" : "贴纸唯一编号", icon: Hash, placeholder: isKo ? "스티커 고유번호(-3)를 스캔하세요" : "请扫描贴纸唯一编号(-3)" },
  ];


  // 3-level navigation: null → order list, order → work items list, order+workItem → scan view
  const { data: dbOrders } = useOrders();

  // Fetch upload_history for logo paths
  const { data: uploadHistoryData } = useQuery({
    queryKey: ["upload_history_logos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_history")
        .select("id, logo_path")
        .not("logo_path", "is", null);
      if (error) throw error;
      return data;
    },
  });

  // Collect all external_order_ids (folder names used by uploaded images)
  const externalOrderIds = useMemo(() => {
    return (dbOrders ?? []).map(o => o.external_order_id).filter(Boolean) as string[];
  }, [dbOrders]);

  // Fetch design images from storage for each external_order_id folder
  const { data: designImageFiles } = useQuery({
    queryKey: ["design_images_by_order", externalOrderIds],
    enabled: externalOrderIds.length > 0,
    queryFn: async () => {
      const fileMap: Record<string, Record<string, string>> = {};
      await Promise.all(externalOrderIds.map(async (folder) => {
        const { data: files } = await supabase.storage.from("design-images").list(folder);
        if (files && files.length > 0) {
          fileMap[folder] = {};
          for (const f of files) {
            const nameWithoutExt = f.name.replace(/\.[^.]+$/, "");
            fileMap[folder][nameWithoutExt] = supabase.storage.from("design-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
          }
        }
      }));
      return fileMap;
    },
  });

  // Fetch twincode images from storage for each external_order_id folder
  const { data: twincodeImageFiles } = useQuery({
    queryKey: ["twincode_images_by_order", externalOrderIds],
    enabled: externalOrderIds.length > 0,
    queryFn: async () => {
      const fileMap: Record<string, Record<string, string>> = {};
      await Promise.all(externalOrderIds.map(async (folder) => {
        const { data: files } = await supabase.storage.from("twincode-images").list(folder);
        if (files && files.length > 0) {
          fileMap[folder] = {};
          for (const f of files) {
            const nameWithoutExt = f.name.replace(/\.[^.]+$/, "");
            fileMap[folder][nameWithoutExt] = supabase.storage.from("twincode-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
          }
        }
      }));
      return fileMap;
    },
  });

  // Map upload_history_id → logo public URL
  const logoUrlMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (uploadHistoryData) {
      for (const h of uploadHistoryData) {
        if (h.logo_path) {
          map[h.id] = supabase.storage.from("order-logos").getPublicUrl(h.logo_path).data.publicUrl;
        }
      }
    }
    return map;
  }, [uploadHistoryData]);

  // Convert DB orders to local OrderData format
  const dbOrderData = useMemo<OrderData[]>(() => {
    if (!dbOrders) return [];
    const sorted = [...dbOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const dateCounters: Record<string, number> = {};
    return sorted.map(o => {
      const d = new Date(o.created_at);
      const dateKey = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      dateCounters[dateKey] = (dateCounters[dateKey] || 0) + 1;
      const orderNo = `${dateKey}-${dateCounters[dateKey]}`;
      const items: WorkItem[] = ((o.source_data as any)?.items ?? []).map((item: any, idx: number) => {
        const qr = `${orderNo}-${idx + 1}`;
        const color = item.tshirt_color ?? "";
        const size = item.tshirt_size ?? "";
        const tshirtKey = `${o.product_code ?? ""}-${color}-${size}`;
        return {
          seq: idx + 1,
          orderIdNo: String(item.order_id ?? item.sequence_no ?? `${o.external_order_id}-${idx + 1}`),
          color,
          size,
          siliconQR: qr,
          designQR: qr,
          hologramQR: qr,
          tshirtSerial: tshirtKey,
          logoUrl: item.twinker_logo_url ?? null,
          designUrl: item.gft_original_image_url ?? item.design_image_url ?? null,
          twincodeUrl: item.twincode_svg_url ?? item.twincode_url ?? null,
          status: "pending" as const,
        };
      });
      const historyId = (o as any).upload_history_id;
      const logoUrl = historyId ? (logoUrlMap[historyId] ?? null) : null;
      const designCode = o.design_code ?? "";
      return {
        id: o.id,
        orderNo,
        externalOrderId: o.external_order_id,
        twinker: o.recipient_name,
        product: o.product_code,
        design: designCode,
        orderDate: new Date(o.created_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN"),
        dueDate: o.project_completed_at ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN") : "-",
        items,
        logoUrl,
        uploadHistoryId: historyId,
        designCode,
      };
    });
  }, [dbOrders, isKo, logoUrlMap]);

  // Merge DB data with local work item statuses
  const [workItemStatuses, setWorkItemStatuses] = useState<Record<string, Record<number, "pending" | "done" | "fail">>>({});
  const orders = useMemo<OrderData[]>(() => {
    return dbOrderData.map(o => ({
      ...o,
      items: o.items.map(item => ({
        ...item,
        status: workItemStatuses[o.id]?.[item.seq] ?? item.status,
      })),
    }));
  }, [dbOrderData, workItemStatuses]);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeWorkItemSeq, setActiveWorkItemSeq] = useState<number | null>(null);

  // Scan state
  const [scanValue, setScanValue] = useState("");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(["waiting", "waiting", "waiting", "waiting"]);
  const [scannedValues, setScannedValues] = useState<string[]>(["", "", "", ""]);
  const [currentStep, setCurrentStep] = useState(0);
  const [matchedProduct, setMatchedProduct] = useState<{ product: string; design: string } | null>(null);
  const [logoVerified, setLogoVerified] = useState(false);
  const [failReason, setFailReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<{ src: string; alt: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOrder = orders.find(o => o.id === selectedOrderId) ?? null;
  const activeWorkItem = selectedOrder?.items.find(i => i.seq === activeWorkItemSeq) ?? null;

  // ---- Work video recording (USB camera) ----
  const queryClient = useQueryClient();
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<{ url: string; label: string } | null>(null);
  const recordTargetRef = useRef<{ folder: string; itemNo: string; orderId: string } | null>(null);
  const defectRef = useRef(false);

  // Videos already stored for the selected order
  const videoFolder = selectedOrder?.externalOrderId ?? "";
  const { data: workVideos } = useQuery({
    queryKey: ["work_videos", videoFolder],
    enabled: !!videoFolder,
    queryFn: async () => {
      const { data } = await supabase.storage.from("work-videos").list(videoFolder);
      const map: Record<string, string> = {};
      for (const f of data ?? []) map[f.name.replace(/\.[^.]+$/, "")] = `${videoFolder}/${f.name}`;
      return map;
    },
  });

  const handleRecorded = useCallback(async (blob: Blob) => {
    const target = recordTargetRef.current;
    if (!target) return;
    setUploadingVideo(true);
    const path = `${target.folder}/${target.itemNo}.webm`;
    try {
      await supabase.storage
        .from("work-videos")
        .upload(path, blob, { contentType: "video/webm", upsert: true });
      // Retention bookkeeping: normal videos expire, defect ones are kept.
      await supabase.from("work_video_records").upsert({
        bucket: "work-videos",
        path,
        order_id: target.orderId,
        external_order_id: target.folder,
        item_no: target.itemNo,
        has_defect: defectRef.current,
        size_bytes: blob.size,
        deleted_at: null,
      }, { onConflict: "path" });
      queryClient.invalidateQueries({ queryKey: ["work_videos", target.folder] });
    } finally {
      setUploadingVideo(false);
    }
  }, [queryClient]);

  const openVideo = useCallback(async (path: string, label: string) => {
    const { data } = await supabase.storage.from("work-videos").createSignedUrl(path, 60 * 60);
    if (data?.signedUrl) setPlayingVideo({ url: data.signedUrl, label });
  }, []);


  const allPass = stepStatuses.every(s => s === "pass");
  const hasFail = stepStatuses.some(s => s === "fail");
  const allDone = stepStatuses.every(s => s === "pass" || s === "fail");

  // Record from the first scan until the last (sticker) code is verified.
  const isRecording = !!activeWorkItem && !!selectedOrder && !!scannedValues[0] && !allDone;
  useEffect(() => {
    if (isRecording && selectedOrder && activeWorkItem) {
      recordTargetRef.current = { folder: selectedOrder.externalOrderId, itemNo: activeWorkItem.orderIdNo, orderId: selectedOrder.id };
    }
  }, [isRecording, selectedOrder, activeWorkItem]);

  // Defect flag decides whether the video is exempt from auto-deletion.
  useEffect(() => { defectRef.current = hasFail; }, [hasFail]);

  // All four codes verified with no mismatch → the item is completed.
  useEffect(() => {
    if (!allPass || !selectedOrder || !activeWorkItem) return;
    setWorkItemStatuses(prev => {
      if (prev[selectedOrder.id]?.[activeWorkItem.seq] === "done") return prev;
      return {
        ...prev,
        [selectedOrder.id]: { ...(prev[selectedOrder.id] ?? {}), [activeWorkItem.seq]: "done" as const },
      };
    });
  }, [allPass, selectedOrder, activeWorkItem]);



  useEffect(() => {
    if (activeWorkItem && !allDone) inputRef.current?.focus();
  }, [currentStep, activeWorkItem, allDone]);

  const resetScan = useCallback(() => {
    setScanValue(""); setStepStatuses(["waiting", "waiting", "waiting", "waiting"]); setScannedValues(["", "", "", ""]);
    setCurrentStep(0); setMatchedProduct(null); setLogoVerified(false); setFailReason(""); setProcessing(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Expected value for each scan step (마크 -1 / 티셔츠 / 디자인 -2 / 스티커 -3)
  const expectedFor = useCallback((step: number, order: OrderData, workItem: WorkItem) => {
    const uid = workItem.orderIdNo;
    if (step === 0) return `${uid}-1`;
    if (step === 1) return `${order.product}-${workItem.color}-${workItem.size}`;
    if (step === 2) return `${uid}-2`;
    return `${uid}-3`;
  }, []);

  // A physical QR may be printed either as the derived unique number (xxx-1/-2/-3)
  // or as the actual QR value registered on the order item / QR master data.
  const acceptedFor = useCallback((step: number, order: OrderData, workItem: WorkItem) => {
    const uid = workItem.orderIdNo;
    const list: (string | undefined | null)[] = [expectedFor(step, order, workItem)];
    if (step === 0) list.push(uid, workItem.siliconQR);
    else if (step === 1) list.push(workItem.tshirtSerial);
    else if (step === 2) list.push(workItem.designQR);
    else list.push(workItem.hologramQR);
    return list.filter(Boolean).map(v => String(v).trim().toLowerCase());
  }, [expectedFor]);

  const processStep = useCallback((step: number, value: string, baseProduct: { product: string; design: string } | null, order: OrderData, workItem: WorkItem) => {
    setProcessing(true);
    setStepStatuses(prev => { const n = [...prev]; n[step] = "scanning"; return n; });
    setScannedValues(prev => { const n = [...prev]; n[step] = value; return n; });
    setTimeout(() => {
      const expected = expectedFor(step, order, workItem);
      const norm = (v: string) => v.trim().toLowerCase();
      let pass = acceptedFor(step, order, workItem).includes(norm(value));
      // T-shirt QR: also accept a master-data QR whose color/size match the item.
      if (!pass && step === 1) {
        const m = mockTshirtQR[value.trim()] || mockTshirtQR[value.trim().toUpperCase()];
        if (m && norm(m.color) === norm(workItem.color) && norm(m.size) === norm(workItem.size)) pass = true;
      }

      const labels = [
        isKo ? "마크 고유번호" : "标识唯一编号",
        isKo ? "티셔츠" : "T恤",
        isKo ? "디자인 고유번호" : "设计唯一编号",
        isKo ? "스티커 고유번호" : "贴纸唯一编号",
      ];
      const reason = pass ? "" : `${labels[step]} ${isKo ? "불일치" : "不匹配"} (${value} ≠ ${expected})`;
      if (pass && step === 0) setMatchedProduct({ product: order.product, design: order.design });
      if (pass && step === 3) setLogoVerified(true);
      setStepStatuses(prev => { const n = [...prev]; n[step] = pass ? "pass" : "fail"; return n; });
      if (!pass) { setFailReason(reason); setProcessing(false); }
      else if (step < 3) { setCurrentStep(step + 1); setProcessing(false); }
      else { setProcessing(false); }
    }, 400);
  }, [isKo, expectedFor, acceptedFor, mockTshirtQR]);


  const handleScan = useCallback((raw?: string) => {
    const value = hangulToQwerty(raw ?? scanValue).trim();
    if (!value || processing || !selectedOrder || !activeWorkItem) return;
    setScanValue("");
    if (hasFail || allDone) { resetScan(); return; }
    processStep(currentStep, value, matchedProduct, selectedOrder, activeWorkItem);
  }, [scanValue, processing, currentStep, matchedProduct, selectedOrder, activeWorkItem, hasFail, allDone, processStep, resetScan]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } };

  // ---- Global scanner capture: works even when the input lost focus ----
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);
  const scanValueRef = useRef("");
  const handleScanRef = useRef(handleScan);

  useEffect(() => {
    scanValueRef.current = scanValue;
    handleScanRef.current = handleScan;
  }, [scanValue, handleScan]);

  useEffect(() => {
    if (!activeWorkItem || allDone || hasFail) return;
    const blockedNavigationKeys = new Set([
      "Tab", "Escape", "F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12",
      "BrowserSearch", "BrowserHome", "BrowserBack", "BrowserForward",
    ]);
    const onKey = (e: KeyboardEvent) => {
      // Hardware scanners can be configured with Ctrl+F, Tab, or other
      // prefix/suffix keys. While scanning a work item, never allow those
      // keys to reach browser find, sidebar search, or another focused field.
      const blockEvent = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };

      // Scanner prefixes such as Ctrl+F/Ctrl+L/Ctrl+K, Alt+D and function
      // keys can move focus to browser search/address UI before QR data arrives.
      // No modified shortcut is needed in the active scanning view, so block
      // every one rather than trying to maintain a browser-specific list.
      if (e.ctrlKey || e.metaKey || e.altKey || blockedNavigationKeys.has(e.key)) {
        blockEvent();
        inputRef.current?.focus();
        return;
      }

      // Modifier keydown events themselves may be scanner prefixes. Suppress
      // them as well; Shift remains available for uppercase QR characters.
      if (e.key === "Control" || e.key === "Meta" || e.key === "Alt") {
        blockEvent();
        inputRef.current?.focus();
        return;
      }

      const now = Date.now();
      if (now - lastKeyRef.current > 1000) bufferRef.current = "";
      lastKeyRef.current = now;

      if (e.key === "Enter") {
        blockEvent();
        const value = bufferRef.current || scanValueRef.current;
        bufferRef.current = "";
        handleScanRef.current(value);
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Backspace") {
        blockEvent();
        bufferRef.current = bufferRef.current.slice(0, -1);
        setScanValue(bufferRef.current);
        return;
      }
      if (e.key.length === 1) {
        blockEvent();
        bufferRef.current += e.key;
        setScanValue(bufferRef.current);
        inputRef.current?.focus();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || blockedNavigationKeys.has(e.key) || e.key === "Control" || e.key === "Meta" || e.key === "Alt") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [activeWorkItem, allDone, hasFail]);

  // Keep the scan input focused so scanner keystrokes never escape the page
  useEffect(() => {
    if (!activeWorkItem || allDone || hasFail) return;
    const id = window.setInterval(() => {
      const active = document.activeElement as HTMLElement | null;
      const inField = !!active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (!inField) inputRef.current?.focus();
    }, 700);
    return () => window.clearInterval(id);
  }, [activeWorkItem, allDone, hasFail]);


  const handleConfirmAttach = () => {
    if (!selectedOrder || !activeWorkItem) return;
    // Mark current work item as done
    setWorkItemStatuses(prev => ({
      ...prev,
      [selectedOrder.id]: {
        ...(prev[selectedOrder.id] ?? {}),
        [activeWorkItem.seq]: "done" as const,
      },
    }));
    // Auto-advance to next pending item
    const nextPending = selectedOrder.items.find(i => i.seq > activeWorkItem.seq && i.status === "pending");
    if (nextPending) {
      setActiveWorkItemSeq(nextPending.seq);
      resetScan();
    } else {
      setActiveWorkItemSeq(null);
      setSelectedOrderId(null);
      resetScan();
    }

  };

  const statusIcon = (s: StepStatus) => {
    switch (s) {
      case "waiting": return <span className="w-6 h-6 rounded-full border-2 border-border flex items-center justify-center text-xs text-muted-foreground">–</span>;
      case "scanning": return <Loader2 className="w-5 h-5 text-[hsl(var(--warning))] animate-spin" />;
      case "pass": return <CheckCircle2 className="w-5 h-5 text-[hsl(var(--success))]" />;
      case "fail": return <XCircle className="w-5 h-5 text-destructive" />;
    }
  };

  const defectLabel = isKo ? "불량" : "不良";

  // ===== VIEW 1: ORDER LIST =====
  if (!selectedOrderId) {
    return (
      <div>
        <PageHeader title={t("tshirtWork.title")} description={t("tshirtWork.selectOrder")} />
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-4 gap-3 section-enter">
            {[
              { label: t("tshirtWork.totalOrders"), value: orders.length, icon: Package, cls: "text-foreground" },
              { label: t("tshirtWork.inProgress"), value: orders.filter(o => o.items.some(i => i.status === "done") && o.items.some(i => i.status === "pending")).length, icon: Clock, cls: "text-primary" },
              { label: t("tshirtWork.completed"), value: orders.filter(o => o.items.every(i => i.status === "done")).length, icon: CheckCircle2, cls: "text-[hsl(var(--success))]" },
              { label: t("tshirtWork.defectTotal"), value: orders.reduce((a, o) => a + o.items.filter(i => i.status === "fail").length, 0), icon: XCircle, cls: "text-destructive" },
            ].map((s, i) => (
              <div key={s.label} className="kpi-card flex items-center gap-3" style={{ animationDelay: `${i * 50}ms` }}>
                <s.icon className={`w-5 h-5 shrink-0 ${s.cls}`} />
                <div>
                  <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {orders.filter(o => o.items.some(i => i.status === "pending")).length > 0 && (
            <div className="section-enter" style={{ animationDelay: "100ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.pendingOrders")}</h3>
              <div className="space-y-2">
                {orders.filter(o => o.items.some(i => i.status === "pending")).map(order => {
                  const done = order.items.filter(i => i.status === "done").length;
                  const fail = order.items.filter(i => i.status === "fail").length;
                  const total = order.items.length;
                  return (
                    <button key={order.id} onClick={() => {
                        const first = order.items.find(i => i.status === "pending") ?? order.items[0];
                        setSelectedOrderId(order.id);
                        setActiveWorkItemSeq(first ? first.seq : null);
                        resetScan();
                      }}
                      className="w-full kpi-card flex items-center gap-4 text-left hover:ring-2 hover:ring-primary/30 transition-all duration-150 active:scale-[0.99] cursor-pointer">

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-primary">{order.externalOrderId}</span>
                          <span className="text-xs text-muted-foreground">· {order.orderNo}</span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{isKo ? "트윈커" : "Twinker"}: <strong className="text-foreground">{order.twinker}</strong></span>
                          <span>{t("tshirtWork.orderDate")}: {order.orderDate}</span>
                          <span>{t("tshirtWork.dueDate")}: {order.dueDate}</span>
                          <span>{t("tshirtWork.workItems")}: <strong className="text-foreground">{total}{isKo ? "건" : "件"}</strong></span>
                        </div>
                      </div>
                      <ProgressBar done={done} total={total} fail={fail} defectLabel={defectLabel} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {orders.filter(o => o.items.every(i => i.status === "done")).length > 0 && (
            <div className="section-enter" style={{ animationDelay: "180ms" }}>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("tshirtWork.completedOrders")}</h3>
              <div className="space-y-2 opacity-70">
                {orders.filter(o => o.items.every(i => i.status === "done")).map(order => {
                  const total = order.items.length;
                  const fail = order.items.filter(i => i.status === "fail").length;
                  return (
                    <div key={order.id} className="kpi-card flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                          <span className="text-sm font-semibold text-primary">{order.externalOrderId}</span>
                          <span className="text-xs text-muted-foreground">· {order.orderNo}</span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{isKo ? "트윈커" : "Twinker"}: {order.twinker}</span>
                        </div>
                      </div>
                      <ProgressBar done={total} total={total} fail={fail} defectLabel={defectLabel} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // No active work item (order fully done / invalid) → back to order list
  if (!activeWorkItemSeq || !activeWorkItem || !selectedOrder) {
    return null;
  }


  // ===== VIEW 3: SCAN VIEW =====
  return (
    <div>
      <PageHeader title={t("tshirtWork.title")} description={`${selectedOrder!.twinker} · #${activeWorkItem.seq}`}>
        <Button variant="outline" size="sm" onClick={() => { setSelectedOrderId(null); setActiveWorkItemSeq(null); resetScan(); }}><ChevronLeft className="w-4 h-4 mr-1" /> {t("tshirtWork.orderList")}</Button>
        <Button variant="outline" size="sm" onClick={resetScan}><RotateCcw className="w-4 h-4 mr-1" /> {t("tshirtWork.reset")}</Button>
      </PageHeader>
      <div className="p-6 space-y-4">
        <div className="kpi-card grid grid-cols-2 md:grid-cols-8 gap-4 items-center">
          <div className="flex items-center gap-2">
            <Shirt className="w-5 h-5 text-primary" />
            <div><p className="text-xs text-muted-foreground">#{activeWorkItem.seq}</p><p className="text-sm font-semibold">{selectedOrder!.twinker}</p></div>
          </div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.product")}</p><p className="text-sm font-semibold">{selectedOrder!.product}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">{isKo ? "마크 고유번호" : "标识唯一编号"}</p>
            <p className="text-sm font-semibold font-mono">{activeWorkItem.orderIdNo}-1</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{isKo ? "디자인 고유번호" : "设计唯一编号"}</p>
            <p className="text-sm font-semibold font-mono">{activeWorkItem.orderIdNo}-2</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{isKo ? "스티커 고유번호" : "贴纸唯一编号"}</p>
            <p className="text-sm font-semibold font-mono">{activeWorkItem.orderIdNo}-3</p>
          </div>

          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.color")}</p><p className="text-sm font-semibold">{activeWorkItem.color}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("tshirtWork.size")}</p><p className="text-sm font-semibold">{activeWorkItem.size}</p></div>
          <div className="ml-auto">
            <p className="text-xs text-muted-foreground text-right">{t("tshirtWork.progressRate")}</p>
            <p className="text-sm font-semibold tabular-nums text-right">
              {selectedOrder!.items.filter(i => i.status === "done").length}/{selectedOrder!.items.length}
            </p>
          </div>
        </div>

        {/* Large O/X result indicator - always visible */}
        {(allPass || hasFail) && (
          <div className={`section-enter rounded-xl border-2 p-6 flex items-center justify-between ${allPass ? "border-[hsl(var(--success))] bg-[hsl(var(--success)/0.06)]" : "border-destructive bg-destructive/5"}`}>
            <div className="flex items-center gap-5">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl font-black ${allPass ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]" : "bg-destructive/10 text-destructive"}`}>
                {allPass ? "O" : "X"}
              </div>
              <div>
                <p className={`text-xl font-bold ${allPass ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                  {allPass ? t("tshirtWork.allPass") : t("tshirtWork.verifyFail")}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {allPass ? `${activeWorkItem.color} / ${activeWorkItem.size} · ${matchedProduct?.product}` : failReason}
                </p>
              </div>
            </div>
            {allPass ? (
              <Button size="lg" onClick={handleConfirmAttach} className="bg-[hsl(var(--success))] hover:bg-[hsl(var(--success)/0.9)] text-white">
                <CheckCircle2 className="w-5 h-5 mr-2" /> {t("tshirtWork.attachDone")}
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={resetScan}>
                <RotateCcw className="w-4 h-4 mr-2" /> {t("tshirtWork.restart")}
              </Button>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-5 section-enter" style={{ animationDelay: "100ms" }}>
          <div className="lg:col-span-2 space-y-4">
            {/* Area 1: USB camera preview + auto recording */}
            <WorkCamRecorder recording={isRecording} onRecorded={handleRecorded} uploading={uploadingVideo} />

            {/* Area 2: auto verification scan */}
            <div className={`kpi-card border-2 transition-colors duration-300 ${hasFail ? "border-destructive" : allPass ? "border-[hsl(var(--success))]" : "border-border"}`}>

              <h3 className="text-sm font-medium mb-5 flex items-center gap-2"><ScanLine className="w-4 h-4" /> {t("tshirtWork.autoScan")}</h3>
              <div className="space-y-3 mb-2">
                {steps.map((step, i) => {
                  const isActive = i === currentStep && !hasFail && !allDone;
                  const expected = expectedFor(i, selectedOrder!, activeWorkItem);
                  return (
                    <div key={step.key} className={`flex items-center gap-3 p-3 rounded-lg transition-colors duration-200 ${isActive ? "bg-primary/5 ring-1 ring-primary/20" : "bg-muted/30"}`}>
                      {statusIcon(stepStatuses[i])}
                      <div className="flex items-center gap-2 w-44 shrink-0">
                        <step.icon className="w-4 h-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className={`text-sm ${isActive ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}>{step.label}</p>
                          <p className="text-[11px] font-mono text-muted-foreground truncate">{expected}</p>
                        </div>
                      </div>
                      {isActive ? (
                        <div className="flex flex-1 gap-2">
                          <input ref={inputRef} type="text" value={scanValue}
                            onChange={e => { bufferRef.current = e.target.value; setScanValue(e.target.value); }}
                            onKeyDown={handleKeyDown}
                            placeholder={step.placeholder} readOnly={processing}
                            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            autoFocus />
                          <Button size="sm" onClick={() => handleScan()} disabled={!scanValue.trim() || processing}>{t("tshirtWork.scan")}</Button>
                        </div>
                      ) : (
                        <span className={`text-sm font-mono flex-1 truncate ${stepStatuses[i] === "fail" ? "text-destructive" : stepStatuses[i] === "pass" ? "text-[hsl(var(--success))]" : "text-muted-foreground"}`}>
                          {scannedValues[i] || "—"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>


            </div>
          </div>

          <div className="space-y-4">
            {/* Logo check */}
            <div className="kpi-card flex flex-col items-center justify-center min-h-[180px]">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start"><Image className="w-4 h-4" /> {t("tshirtWork.logoCheck")}</h3>
              {(activeWorkItem.logoUrl || selectedOrder!.logoUrl) ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <div
                    className={`w-28 h-28 rounded-lg border-2 bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow ${logoVerified ? "border-[hsl(var(--success)/0.3)]" : "border-border"}`}
                    onClick={() => setZoomedImage({ src: (activeWorkItem.logoUrl || selectedOrder!.logoUrl)!, alt: "Logo" })}
                  >
                    <img src={(activeWorkItem.logoUrl || selectedOrder!.logoUrl)!} alt="Logo" className="max-w-full max-h-full object-contain" />
                  </div>
                  {logoVerified ? (
                    <span className="text-xs text-[hsl(var(--success))] font-medium flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> {t("tshirtWork.logoConfirmed")}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{isKo ? "클릭하여 확대" : "点击放大"}</span>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <Image className="w-8 h-8 opacity-30" />
                  <p className="text-xs">{isKo ? "로고 없음" : "无Logo"}</p>
                </div>
              )}
            </div>

            {/* Design image check (per work item by tshirt_serial) */}
            {(() => {
              const folder = selectedOrder!.externalOrderId;
              const files = (folder && designImageFiles?.[folder]) || {};
              const cands = [`${activeWorkItem.orderIdNo}-2`, activeWorkItem.orderIdNo, activeWorkItem.tshirtSerial, String(activeWorkItem.seq)];
              const key = cands.find(c => c && files[c]) ?? `${activeWorkItem.orderIdNo}-2`;
              const url = files[key] || activeWorkItem.designUrl || null;


              return (
                <div className="kpi-card flex flex-col items-center justify-center min-h-[180px]">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start"><QrCode className="w-4 h-4" /> {isKo ? "디자인 확인" : "设计确认"}</h3>
                  {url ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                      <div
                        className="w-28 h-28 rounded-lg border-2 border-border bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
                        onClick={() => setZoomedImage({ src: url, alt: "Design" })}
                      >
                        <img src={url} alt="Design" className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className="text-xs text-muted-foreground">{isKo ? "클릭하여 확대" : "点击放大"} · <span className="font-mono">{key}</span></span>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                      <QrCode className="w-8 h-8 opacity-30" />
                      <p className="text-xs">{isKo ? "디자인 이미지 없음" : "无设计图片"}</p>
                      {key && <p className="text-[10px] font-mono opacity-60">{key}</p>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Twincode image check (per work item by tshirt_serial) */}
            {(() => {
              const folder = selectedOrder!.externalOrderId;
              const files = (folder && twincodeImageFiles?.[folder]) || {};
              const cands = [activeWorkItem.orderIdNo, `${activeWorkItem.orderIdNo}-2`, activeWorkItem.tshirtSerial, String(activeWorkItem.seq)];
              const key = cands.find(c => c && files[c]) ?? activeWorkItem.orderIdNo;
              const url = files[key] || activeWorkItem.twincodeUrl || null;


              return (
                <div className="kpi-card flex flex-col items-center justify-center min-h-[180px]">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2 self-start"><Hash className="w-4 h-4" /> {isKo ? "트윈코드 확인" : "TwinCode确认"}</h3>
                  {url ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-2">
                      <div
                        className="w-28 h-28 rounded-lg border-2 border-border bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/40 transition-shadow"
                        onClick={() => setZoomedImage({ src: url, alt: "TwinCode" })}
                      >
                        <img src={url} alt="TwinCode" className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className="text-xs text-muted-foreground">{isKo ? "클릭하여 확대" : "点击放大"} · <span className="font-mono">{key}</span></span>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
                      <Hash className="w-8 h-8 opacity-30" />
                      <p className="text-xs">{isKo ? "트윈코드 이미지 없음" : "无TwinCode图片"}</p>
                      {key && <p className="text-[10px] font-mono opacity-60">{key}</p>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Actual work item list for this order */}
        <div className="kpi-card section-enter" style={{ animationDelay: "160ms" }}>
          <h3 className="text-sm font-medium mb-4 flex items-center gap-2">
            <List className="w-4 h-4" /> {t("tshirtWork.workItems")}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {selectedOrder!.items.filter(i => i.status === "done").length}/{selectedOrder!.items.length} {t("tshirtWork.completed")}
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                {[
                  isKo ? "주문번호" : "订单号",
                  isKo ? "티셔츠 종류" : "T恤种类",
                  t("tshirtWork.color"),
                  t("tshirtWork.size"),
                  isKo ? "마크고유번호" : "标识唯一编号",
                  isKo ? "디자인 고유번호" : "设计唯一编号",
                  isKo ? "스티커 고유번호" : "贴纸唯一编号",
                  t("tshirtWork.status"),
                  isKo ? "영상 재생" : "视频播放",
                ].map(h => <th key={h} className="pb-2 font-medium text-muted-foreground whitespace-nowrap pr-4">{h}</th>)}
                <th className="pb-2"></th>
              </tr></thead>
              <tbody>
                {selectedOrder!.items.map(item => {
                  const videoPath = workVideos?.[item.orderIdNo];
                  return (
                  <tr key={item.seq}
                    className={`border-b last:border-0 transition-colors ${item.seq === activeWorkItem.seq ? "bg-primary/5" : item.status === "pending" ? "hover:bg-muted/30" : ""}`}>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}</td>
                    <td className="py-2.5 pr-4 font-medium">{selectedOrder!.product || "-"}</td>
                    <td className="py-2.5 pr-4 font-medium">{item.color}</td>
                    <td className="py-2.5 pr-4">{item.size}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-1</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-2</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-3</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={item.status} t={t} /></td>
                    <td className="py-2.5 pr-4">
                      {videoPath ? (
                        <Button variant="outline" size="sm" onClick={() => openVideo(videoPath, `#${item.seq} ${item.orderIdNo}`)}>
                          <Play className="w-3.5 h-3.5 mr-1" /> {isKo ? "영상 재생" : "播放"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{isKo ? "영상 없음" : "无视频"}</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {item.seq === activeWorkItem.seq ? (
                        <span className="text-xs font-medium text-primary">{isKo ? "작업 중" : "作业中"}</span>
                      ) : item.status === "pending" ? (
                        <Button variant="outline" size="sm" onClick={() => { setActiveWorkItemSeq(item.seq); resetScan(); }}>
                          <ScanLine className="w-3.5 h-3.5 mr-1" /> {t("tshirtWork.startVerify")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>


      {/* Zoomed image dialog */}
      <Dialog open={!!zoomedImage} onOpenChange={() => setZoomedImage(null)}>
        <DialogContent className="max-w-3xl p-2 bg-background">
          {zoomedImage && (
            <div className="flex items-center justify-center p-4">
              <img src={zoomedImage.src} alt={zoomedImage.alt} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Work video playback dialog */}
      <Dialog open={!!playingVideo} onOpenChange={() => setPlayingVideo(null)}>
        <DialogContent className="max-w-3xl p-4 bg-background">
          {playingVideo && (
            <div className="space-y-2">
              <p className="text-sm font-medium font-mono">{playingVideo.label}</p>
              <video src={playingVideo.url} controls autoPlay className="w-full rounded-lg bg-black" />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import WorkCamRecorder from "@/components/WorkCamRecorder";
import { toast } from "@/hooks/use-toast";



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

// Physical-key → latin character map. Scanners send US-QWERTY key codes, so
// deriving the character from `event.code` makes scanning immune to the OS
// input language (Korean IME, etc.).
const CODE_CHAR_MAP: Record<string, [string, string]> = (() => {
  const map: Record<string, [string, string]> = {};
  for (const c of "abcdefghijklmnopqrstuvwxyz") map[`Key${c.toUpperCase()}`] = [c, c.toUpperCase()];
  const digits: Record<string, string> = { "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")" };
  for (const [d, s] of Object.entries(digits)) {
    map[`Digit${d}`] = [d, s];
    map[`Numpad${d}`] = [d, d];
  }
  Object.assign(map, {
    Minus: ["-", "_"], Equal: ["=", "+"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
    Backslash: ["\\", "|"], Semicolon: [";", ":"], Quote: ["'", '"'], Backquote: ["`", "~"],
    Comma: [",", "<"], Period: [".", ">"], Slash: ["/", "?"], Space: [" ", " "],
    NumpadSubtract: ["-", "-"], NumpadAdd: ["+", "+"], NumpadDecimal: [".", "."],
    NumpadMultiply: ["*", "*"], NumpadDivide: ["/", "/"],
  } as Record<string, [string, string]>);
  return map;
})();

// Returns the latin character for a keydown event regardless of the active IME.
function latinCharFromEvent(e: KeyboardEvent): string | null {
  const mapped = CODE_CHAR_MAP[e.code];
  if (mapped) return e.shiftKey ? mapped[1] : mapped[0];
  if (e.key.length === 1) return hangulToQwerty(e.key);
  return null;
}


// Scanners may append non-printing separators or emit a Unicode dash that
// looks identical to "-" on screen. Canonicalize both scanned and stored QR
// values before comparing them.
function normalizeQrValue(input: string): string {
  return hangulToQwerty(input)
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .trim()
    .toLowerCase();
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

  // Persisted work item results (survive refresh / page changes)
  const { data: savedWorkItems } = useQuery({
    queryKey: ["tshirt_work_items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tshirt_work_items")
        .select("order_id, seq, status, rework_reason, reworked_at, rework_count");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10_000,
  });

  const [localStatuses, setLocalStatuses] = useState<Record<string, Record<number, "pending" | "done" | "fail">>>({});
  const workItemStatuses = useMemo(() => {
    const merged: Record<string, Record<number, "pending" | "done" | "fail">> = {};
    for (const row of savedWorkItems ?? []) {
      const st = row.status as "pending" | "done" | "fail";
      merged[row.order_id] = { ...(merged[row.order_id] ?? {}), [row.seq]: st };
    }
    for (const [oid, seqs] of Object.entries(localStatuses)) {
      merged[oid] = { ...(merged[oid] ?? {}), ...seqs };
    }
    return merged;
  }, [savedWorkItems, localStatuses]);

  // Rework metadata per order/seq (reason + timestamp + how many times).
  const reworkInfo = useMemo(() => {
    const map: Record<string, Record<number, { reason: string | null; at: string | null; count: number }>> = {};
    for (const row of savedWorkItems ?? []) {
      const r = row as { order_id: string; seq: number; rework_reason?: string | null; reworked_at?: string | null; rework_count?: number | null };
      if (!r.reworked_at) continue;
      map[r.order_id] = { ...(map[r.order_id] ?? {}), [r.seq]: { reason: r.rework_reason ?? null, at: r.reworked_at, count: r.rework_count ?? 0 } };
    }
    return map;
  }, [savedWorkItems]);

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
  const [playingVideo, setPlayingVideo] = useState<
    { label: string; takes: { path: string; name: string; url: string }[]; index: number } | null
  >(null);
  const recordTargetRef = useRef<{ folder: string; itemNo: string; orderId: string } | null>(null);
  const defectRef = useRef(false);

  // Videos already stored for the selected order, grouped per work item.
  // Older takes are kept: files are named `<itemNo>__<timestamp>.webm`.
  const videoFolder = selectedOrder?.externalOrderId ?? "";
  const { data: workVideos } = useQuery({
    queryKey: ["work_videos", videoFolder],
    enabled: !!videoFolder,
    queryFn: async () => {
      const { data } = await supabase.storage.from("work-videos").list(videoFolder, { limit: 1000 });
      const map: Record<string, { path: string; name: string }[]> = {};
      for (const f of data ?? []) {
        const base = f.name.replace(/\.[^.]+$/, "");
        const itemNo = base.split("__")[0];
        (map[itemNo] ??= []).push({ path: `${videoFolder}/${f.name}`, name: base });
      }
      for (const list of Object.values(map)) list.sort((a, b) => a.name.localeCompare(b.name));
      return map;
    },
  });

  const handleRecorded = useCallback(async (blob: Blob) => {
    const target = recordTargetRef.current;
    if (!target) return;
    setUploadingVideo(true);
    // Unique file name per take so previous recordings stay available.
    const path = `${target.folder}/${target.itemNo}__${Date.now()}.webm`;
    try {
      const { error: upErr } = await supabase.storage
        .from("work-videos")
        .upload(path, blob, { contentType: "video/webm", upsert: true });
      if (upErr) {
        toast({ title: isKo ? "영상 저장 실패" : "视频保存失败", description: upErr.message, variant: "destructive" });
        return;
      }
      // Retention bookkeeping: normal videos expire, defect ones are kept.
      const { error: recErr } = await supabase.from("work_video_records").upsert({
        bucket: "work-videos",
        path,
        order_id: target.orderId,
        external_order_id: target.folder,
        item_no: target.itemNo,
        has_defect: defectRef.current,
        size_bytes: blob.size,
        deleted_at: null,
      }, { onConflict: "path" });
      if (recErr) {
        toast({ title: isKo ? "영상 기록 저장 실패" : "视频记录保存失败", description: recErr.message, variant: "destructive" });
      } else {
        toast({ title: isKo ? "작업 영상 저장됨" : "作业视频已保存", description: path });
      }
      queryClient.invalidateQueries({ queryKey: ["work_videos", target.folder] });
    } finally {
      setUploadingVideo(false);
    }
  }, [queryClient, isKo]);


  // Open every recorded take for a work item (original + rework recordings).
  const openVideo = useCallback(async (takes: { path: string; name: string }[], label: string) => {
    const signed = await Promise.all(takes.map(async tk => {
      const { data } = await supabase.storage.from("work-videos").createSignedUrl(tk.path, 60 * 60);
      return { ...tk, url: data?.signedUrl ?? "" };
    }));
    const usable = signed.filter(s => s.url);
    if (usable.length) setPlayingVideo({ label, takes: usable, index: usable.length - 1 });
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

  // Persist a work item result to the server so it survives refresh/navigation.
  const persistWorkItem = useCallback(async (
    orderId: string,
    seq: number,
    status: "done" | "fail",
    opts?: { itemNo?: string; scanned?: string[]; failReason?: string },
  ) => {
    setLocalStatuses(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] ?? {}), [seq]: status },
    }));
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("tshirt_work_items").upsert({
      order_id: orderId,
      seq,
      item_no: opts?.itemNo ?? null,
      status,
      scanned_values: opts?.scanned ?? [],
      fail_reason: opts?.failReason ?? null,
      completed_at: new Date().toISOString(),
      worked_by: auth.user?.id ?? null,
    }, { onConflict: "order_id,seq" });
    if (error) {
      toast({ title: isKo ? "작업 결과 저장 실패" : "作业结果保存失败", description: error.message, variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["tshirt_work_items"] });
    }
  }, [queryClient, isKo]);

  // All four codes verified with no mismatch → the item is completed.
  useEffect(() => {
    if (!allPass || !selectedOrder || !activeWorkItem) return;
    if (workItemStatuses[selectedOrder.id]?.[activeWorkItem.seq] === "done") return;
    persistWorkItem(selectedOrder.id, activeWorkItem.seq, "done", {
      itemNo: activeWorkItem.orderIdNo,
      scanned: scannedValues,
    });
  }, [allPass, selectedOrder, activeWorkItem, workItemStatuses, scannedValues, persistWorkItem]);

  // A mismatch marks the item as defective, also persisted.
  useEffect(() => {
    if (!hasFail || !allDone || !selectedOrder || !activeWorkItem) return;
    if (workItemStatuses[selectedOrder.id]?.[activeWorkItem.seq] === "fail") return;
    persistWorkItem(selectedOrder.id, activeWorkItem.seq, "fail", {
      itemNo: activeWorkItem.orderIdNo,
      scanned: scannedValues,
      failReason: failReason || undefined,
    });
  }, [hasFail, allDone, selectedOrder, activeWorkItem, workItemStatuses, scannedValues, failReason, persistWorkItem]);




  useEffect(() => {
    if (activeWorkItem && !allDone) inputRef.current?.focus();
  }, [currentStep, activeWorkItem, allDone]);

  const resetScan = useCallback(() => {
    bufferRef.current = "";
    scanValueRef.current = "";
    setScanValue(""); setStepStatuses(["waiting", "waiting", "waiting", "waiting"]); setScannedValues(["", "", "", ""]);
    setCurrentStep(0); setMatchedProduct(null); setLogoVerified(false); setFailReason(""); setProcessing(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Hard reset: wipe ALL work items of the selected order AND delete every
  // recorded video of that order from server storage.
  const [hardResetting, setHardResetting] = useState(false);
  const hardResetItem = useCallback(async () => {
    if (!selectedOrder) return;
    const totalItems = selectedOrder.items.length;
    const confirmMsg = isKo
      ? `작업건 목록의 모든 주문건(${totalItems}건)의 완료 데이터와 저장된 영상을 모두 삭제할까요? 되돌릴 수 없습니다.`
      : `确定删除该作业清单中全部 ${totalItems} 项的完成数据和已保存视频吗？此操作不可撤销。`;
    if (!window.confirm(confirmMsg)) return;
    setHardResetting(true);
    try {
      // 1) Remove every recorded take of this order from storage
      const folder = selectedOrder.externalOrderId;
      const { data: files } = await supabase.storage.from("work-videos").list(folder, { limit: 1000 });
      const paths = (files ?? []).map(f => `${folder}/${f.name}`);
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from("work-videos").remove(paths);
        if (rmErr) throw rmErr;
        await supabase
          .from("work_video_records")
          .update({ deleted_at: new Date().toISOString(), retain: false })
          .in("path", paths);
      }
      // 2) Remove all persisted work results for this order
      const { error: delErr } = await supabase
        .from("tshirt_work_items")
        .delete()
        .eq("order_id", selectedOrder.id);
      if (delErr) throw delErr;

      setLocalStatuses(prev => {
        const cleared: Record<number, string> = {};
        selectedOrder.items.forEach(i => { cleared[i.seq] = "pending"; });
        return { ...prev, [selectedOrder.id]: cleared as any };
      });
      resetScan();
      queryClient.invalidateQueries({ queryKey: ["tshirt_work_items"] });
      queryClient.invalidateQueries({ queryKey: ["work_videos", folder] });
      toast({
        title: isKo ? "초기화 완료" : "重置完成",
        description: isKo
          ? `작업건 ${totalItems}건, 영상 ${paths.length}건 삭제됨`
          : `已删除 ${totalItems} 项作业、${paths.length} 个视频`,
      });
    } catch (e: any) {
      toast({ title: isKo ? "초기화 실패" : "重置失败", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setHardResetting(false);
    }
  }, [selectedOrder, isKo, resetScan, queryClient]);



  // Rework requires a reason; it is logged to the defect/exception board.
  const [reworkTarget, setReworkTarget] = useState<{ seq: number; itemNo: string } | null>(null);
  const [reworkReason, setReworkReason] = useState("");
  const [reworkSaving, setReworkSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  // Reset an already finished item back to pending so it can be re-verified.
  const reworkItem = useCallback(async (seq: number, reason: string) => {
    if (!selectedOrderId) return;
    const order = orders.find(o => o.id === selectedOrderId) ?? null;
    const item = order?.items.find(i => i.seq === seq) ?? null;
    const prevCount = reworkInfo[selectedOrderId]?.[seq]?.count ?? 0;
    setLocalStatuses(prev => ({
      ...prev,
      [selectedOrderId]: { ...(prev[selectedOrderId] ?? {}), [seq]: "pending" },
    }));
    setActiveWorkItemSeq(seq);
    resetScan();
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from("tshirt_work_items").upsert({
      order_id: selectedOrderId,
      seq,
      item_no: item?.orderIdNo ?? null,
      status: "pending",
      scanned_values: [],
      fail_reason: null,
      completed_at: null,
      rework_reason: reason,
      reworked_at: new Date().toISOString(),
      rework_count: prevCount + 1,
    }, { onConflict: "order_id,seq" });
    if (error) {
      toast({ title: isKo ? "재작업 처리 실패" : "返工处理失败", description: error.message, variant: "destructive" });
      return;
    }
    const { error: logErr } = await supabase.from("defect_logs").insert({
      source: "tshirt_work",
      order_id: selectedOrderId,
      external_order_id: order?.externalOrderId ?? null,
      item_no: item?.orderIdNo ?? null,
      seq,
      defect_type: "attach_fail",
      severity: "medium",
      occurred_process: isKo ? "티셔츠 부착 작업" : "T恤贴附作业",
      detail: reason,
      status: "rework_queued",
      restart_stage: "tshirt",
      created_by: auth.user?.id ?? null,
    });
    if (logErr) {
      toast({ title: isKo ? "불량 로그 기록 실패" : "不良日志记录失败", description: logErr.message, variant: "destructive" });
    }
    queryClient.invalidateQueries({ queryKey: ["tshirt_work_items"] });
    queryClient.invalidateQueries({ queryKey: ["defect_logs"] });
    toast({ title: isKo ? "재작업으로 전환됨" : "已转为返工", description: `#${seq}` });
  }, [selectedOrderId, orders, reworkInfo, resetScan, queryClient, isKo]);



  // Expected value for each scan step (마크 -1 / 티셔츠 / 디자인 -2 / 스티커 -3)
  const expectedFor = useCallback((step: number, order: OrderData, workItem: WorkItem) => {
    const uid = workItem.orderIdNo;
    if (step === 0) return `${uid}-1`;
    if (step === 1) return `${order.product}-${workItem.color}-${workItem.size}`;
    if (step === 2) return `${uid}-2`;
    return `${uid}-3`;
  }, []);

  // Scanner glitches (dropped/duplicated/inserted keystroke) produce a value that
  // differs from the expected one by a single character. Detect it to warn the worker.
  const isOneEditApart = (a: string, b: string) => {
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    let i = 0, j = 0, edits = 0;
    while (i < s.length && j < l.length) {
      if (s[i] === l[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (s.length === l.length) i++;
      j++;
    }
    return edits + (l.length - j) + (s.length - i) <= 1;
  };


  // A physical QR may be printed either as the derived unique number (xxx-1/-2/-3)
  // or as the actual QR value registered on the order item / QR master data.
  const acceptedFor = useCallback((step: number, order: OrderData, workItem: WorkItem) => {
    const uid = workItem.orderIdNo;
    const list: (string | undefined | null)[] = [expectedFor(step, order, workItem)];
    if (step === 0) list.push(uid, workItem.siliconQR);
    else if (step === 1) list.push(workItem.tshirtSerial);
    else if (step === 2) list.push(workItem.designQR);
    else list.push(workItem.hologramQR);
    return list.filter(Boolean).map(v => normalizeQrValue(String(v)));
  }, [expectedFor]);

  const processStep = useCallback((step: number, value: string, baseProduct: { product: string; design: string } | null, order: OrderData, workItem: WorkItem) => {
    setProcessing(true);
    setStepStatuses(prev => { const n = [...prev]; n[step] = "scanning"; return n; });
    setScannedValues(prev => { const n = [...prev]; n[step] = value; return n; });
    setTimeout(() => {
      const expected = expectedFor(step, order, workItem);
      const norm = normalizeQrValue;
      let pass = acceptedFor(step, order, workItem).includes(norm(value));
      // T-shirt QR: also accept a master-data QR whose color/size match the item.
      if (!pass && step === 1) {
        const cleanValue = value.trim();
        const m = mockTshirtQR[cleanValue] || mockTshirtQR[cleanValue.toUpperCase()];
        if (m && norm(m.color) === norm(workItem.color) && norm(m.size) === norm(workItem.size)) pass = true;
      }

      const labels = [
        isKo ? "마크 고유번호" : "标识唯一编号",
        isKo ? "티셔츠" : "T恤",
        isKo ? "디자인 고유번호" : "设计唯一编号",
        isKo ? "스티커 고유번호" : "贴纸唯一编号",
      ];
      const glitch = !pass && acceptedFor(step, order, workItem).some(a => isOneEditApart(a, norm(value)));
      const reason = pass
        ? ""
        : glitch
          ? `${labels[step]} ${isKo ? "스캐너 오입력 의심 — 한 글자가 빠지거나 중복 입력되었습니다. 다시 스캔하세요." : "疑似扫描枪误输入 — 缺少或重复了一个字符，请重新扫描。"} (${value} ≠ ${expected})`
          : `${labels[step]} ${isKo ? "불일치" : "不匹配"} (${value} ≠ ${expected})`;
      if (pass && step === 0) setMatchedProduct({ product: order.product, design: order.design });
      if (pass && step === 3) setLogoVerified(true);
      setStepStatuses(prev => { const n = [...prev]; n[step] = pass ? "pass" : "fail"; return n; });
      if (!pass) { setFailReason(reason); setProcessing(false); }
      else if (step < 3) { setCurrentStep(step + 1); setProcessing(false); }
      else { setProcessing(false); }
    }, 400);
  }, [isKo, expectedFor, acceptedFor, mockTshirtQR]);


  const handleScan = useCallback((raw?: string) => {
    const value = normalizeQrValue(raw ?? scanValue);
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
      // Never hijack typing in other editable fields (rework reason textarea,
      // search box, dialogs). Korean IME composition must be left untouched.
      const el = e.target as HTMLElement | null;
      const editable =
        el &&
        (el.isContentEditable ||
          el.tagName === "TEXTAREA" ||
          (el.tagName === "INPUT" && el !== inputRef.current));
      if (editable || e.isComposing || e.key === "Process" || (e as any).keyCode === 229) return;

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

      // With a Korean IME active the browser reports key as "Process"; rely on
      // the physical key code (e.code) instead so scanning is always latin.
      if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") {
        blockEvent();
        const value = bufferRef.current || scanValueRef.current;
        bufferRef.current = "";
        handleScanRef.current(value);
        inputRef.current?.focus();
        return;
      }
      if (e.key === "Backspace" || e.code === "Backspace") {
        blockEvent();
        bufferRef.current = bufferRef.current.slice(0, -1);
        setScanValue(bufferRef.current);
        return;
      }
      const ch = latinCharFromEvent(e);
      if (ch) {
        blockEvent();
        bufferRef.current += ch;
        setScanValue(bufferRef.current);
        inputRef.current?.focus();
      }

    };
    const onKeyUp = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && el !== inputRef.current))) return;
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
    // Mark current work item as done (persisted server-side)
    persistWorkItem(selectedOrder.id, activeWorkItem.seq, "done", {
      itemNo: activeWorkItem.orderIdNo,
      scanned: scannedValues,
    });

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

  // Auto-advance to the next work item once all 4 steps pass.
  const confirmRef = useRef(handleConfirmAttach);
  useEffect(() => { confirmRef.current = handleConfirmAttach; });
  useEffect(() => {
    if (!allPass || hasFail || !activeWorkItem) return;
    const id = window.setTimeout(() => confirmRef.current(), 1500);
    return () => window.clearTimeout(id);
  }, [allPass, hasFail, activeWorkItem]);



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
              <div className="space-y-2">
                {orders.filter(o => o.items.every(i => i.status === "done")).map(order => {
                  const total = order.items.length;
                  const fail = order.items.filter(i => i.status === "fail").length;
                  return (
                    <button key={order.id} onClick={() => {
                        const first = order.items[0];
                        setSelectedOrderId(order.id);
                        setActiveWorkItemSeq(first ? first.seq : null);
                        resetScan();
                      }}
                      className="w-full kpi-card flex items-center gap-4 text-left hover:ring-2 hover:ring-primary/30 transition-all duration-150 active:scale-[0.99] cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                          <span className="text-sm font-semibold text-primary">{order.externalOrderId}</span>
                          <span className="text-xs text-muted-foreground">· {order.orderNo}</span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{isKo ? "트윈커" : "Twinker"}: {order.twinker}</span>
                          <span>{t("tshirtWork.orderDate")}: {order.orderDate}</span>
                          <span>{t("tshirtWork.dueDate")}: {order.dueDate}</span>
                          <span>{t("tshirtWork.workItems")}: <strong className="text-foreground">{total}{isKo ? "건" : "件"}</strong></span>
                        </div>
                      </div>
                      <ProgressBar done={total} total={total} fail={fail} defectLabel={defectLabel} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
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
        <Button variant="outline" size="sm" onClick={hardResetItem} disabled={hardResetting}><RotateCcw className={`w-4 h-4 mr-1 ${hardResetting ? "animate-spin" : ""}`} /> {t("tshirtWork.reset")}</Button>
      </PageHeader>
      <div className="p-6 space-y-4">

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
                {allPass && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {isKo ? "잠시 후 다음 작업건으로 자동 이동합니다" : "稍后自动进入下一作业项"}
                  </p>
                )}

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

              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-medium flex items-center gap-2"><ScanLine className="w-4 h-4" /> {t("tshirtWork.autoScan")}</h3>
                <Button variant="outline" size="sm" onClick={resetScan} title={isKo ? "현재 스캔 기록만 지웁니다" : "仅清除当前扫描记录"}>
                  <RotateCcw className="w-4 h-4 mr-1" /> {isKo ? "초기화" : "重置"}
                </Button>
              </div>
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
                            lang="en" inputMode="text" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                            onChange={e => {
                              // Strip any IME output so the field is always latin.
                              const v = hangulToQwerty(e.target.value);
                              bufferRef.current = v; setScanValue(v);
                            }}
                            onCompositionEnd={e => {
                              const v = hangulToQwerty((e.target as HTMLInputElement).value);
                              bufferRef.current = v; setScanValue(v);
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder={step.placeholder} readOnly={processing}
                            style={{ imeMode: "disabled" } as React.CSSProperties}
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
        {(() => {
          const rw = reworkInfo[selectedOrder!.id] ?? {};
          const isRework = (item: WorkItem) => !!rw[item.seq] && item.status === "pending";
          const reworkCount = selectedOrder!.items.filter(isRework).length;
          const q = itemSearch.trim().toLowerCase();
          const visibleItems = q
            ? selectedOrder!.items.filter(i =>
                [i.orderIdNo, i.color, i.size, selectedOrder!.product, `${i.orderIdNo}-1`, `${i.orderIdNo}-2`, `${i.orderIdNo}-3`, String(i.seq)]
                  .some(v => (v ?? "").toString().toLowerCase().includes(q)))
            : selectedOrder!.items;
          return (
        <div className="kpi-card section-enter" style={{ animationDelay: "160ms" }}>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2 flex-wrap">
            <List className="w-4 h-4" /> {t("tshirtWork.workItems")}
            {reworkCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                <RotateCcw className="w-3 h-3" /> {isKo ? "재작업" : "返工"} {reworkCount}
              </span>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {selectedOrder!.items.filter(i => i.status === "done").length}/{selectedOrder!.items.length} {t("tshirtWork.completed")}
            </span>
          </h3>
          <div className="mb-3">
            <Input
              value={itemSearch}
              onChange={e => setItemSearch(e.target.value)}
              placeholder={isKo ? "주문번호 · 색상 · 사이즈 · 고유번호 검색" : "搜索订单号 · 颜色 · 尺码 · 唯一编号"}
              className="h-8 max-w-xs text-sm"
            />
          </div>
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
                {visibleItems.length === 0 && (
                  <tr><td colSpan={10} className="py-6 text-center text-xs text-muted-foreground">{isKo ? "검색 결과가 없습니다" : "无搜索结果"}</td></tr>
                )}
                {visibleItems.map(item => {
                  const takes = workVideos?.[item.orderIdNo] ?? [];
                  const rework = isRework(item);
                  return (
                  <tr key={item.seq}
                    onClick={() => { if (item.seq !== activeWorkItem.seq) { setActiveWorkItemSeq(item.seq); resetScan(); } }}
                    className={`border-b last:border-0 transition-colors cursor-pointer ${
                      rework ? "bg-destructive/10 hover:bg-destructive/15" : item.seq === activeWorkItem.seq ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="py-2.5 font-mono text-xs pr-4">
                      {item.orderIdNo}
                      {rework && (
                        <span className="ml-1.5 text-[10px] font-medium text-destructive" title={rw[item.seq]?.reason ?? ""}>
                          {isKo ? "재작업" : "返工"}{(rw[item.seq]?.count ?? 0) > 1 ? ` ×${rw[item.seq]?.count}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{selectedOrder!.product || "-"}</td>
                    <td className="py-2.5 pr-4 font-medium">{item.color}</td>
                    <td className="py-2.5 pr-4">{item.size}</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-1</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-2</td>
                    <td className="py-2.5 font-mono text-xs pr-4">{item.orderIdNo}-3</td>
                    <td className="py-2.5 pr-4"><StatusBadge status={item.status} t={t} /></td>
                    <td className="py-2.5 pr-4" onClick={e => e.stopPropagation()}>
                      {takes.length > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => openVideo(takes, `#${item.seq} ${item.orderIdNo}`)}>
                          <Play className="w-3.5 h-3.5 mr-1" /> {isKo ? "영상 재생" : "播放"}
                          {takes.length > 1 && <span className="ml-1 text-[10px] opacity-70">({takes.length})</span>}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{isKo ? "영상 없음" : "无视频"}</span>
                      )}
                    </td>
                    <td className="py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {item.seq === activeWorkItem.seq ? (
                          <span className="text-xs font-medium text-primary">{isKo ? "선택됨" : "已选择"}</span>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => { setActiveWorkItemSeq(item.seq); resetScan(); }}>
                            {item.status === "pending" ? (<><ScanLine className="w-3.5 h-3.5 mr-1" /> {t("tshirtWork.startVerify")}</>) : (<><Image className="w-3.5 h-3.5 mr-1" /> {isKo ? "확인" : "查看"}</>)}
                          </Button>
                        )}
                        {item.status !== "pending" && (
                          <Button variant="ghost" size="sm" onClick={() => { setReworkReason(""); setReworkTarget({ seq: item.seq, itemNo: item.orderIdNo }); }}>
                            <RotateCcw className="w-3.5 h-3.5 mr-1" /> {isKo ? "재작업" : "返工"}
                          </Button>
                        )}
                      </div>
                    </td>

                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
          );
        })()}
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

      {/* Work video playback dialog — every take (original + reworks) is kept */}
      <Dialog open={!!playingVideo} onOpenChange={() => setPlayingVideo(null)}>
        <DialogContent className="max-w-3xl p-4 bg-background">
          {playingVideo && (
            <div className="space-y-3">
              <p className="text-sm font-medium font-mono">{playingVideo.label}</p>
              <video key={playingVideo.takes[playingVideo.index].path} src={playingVideo.takes[playingVideo.index].url} controls autoPlay className="w-full rounded-lg bg-black" />
              {playingVideo.takes.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {playingVideo.takes.map((tk, i) => {
                    const ts = tk.name.split("__")[1];
                    const label = ts ? new Date(Number(ts)).toLocaleString(isKo ? "ko-KR" : "zh-CN") : (isKo ? "최초 작업" : "首次作业");
                    return (
                      <Button key={tk.path} size="sm" variant={i === playingVideo.index ? "default" : "outline"}
                        onClick={() => setPlayingVideo(p => p && { ...p, index: i })}>
                        {i === 0 ? (isKo ? "최초" : "首次") : `${isKo ? "재작업" : "返工"} ${i}`} · {label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rework reason dialog */}
      <Dialog open={!!reworkTarget} onOpenChange={o => { if (!o) setReworkTarget(null); }}>
        <DialogContent className="max-w-md p-5 bg-background">
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {isKo ? "재작업 사유 입력" : "输入返工原因"}
              {reworkTarget && <span className="ml-2 font-mono text-xs text-muted-foreground">#{reworkTarget.seq} {reworkTarget.itemNo}</span>}
            </p>
            <Textarea
              value={reworkReason}
              onChange={e => setReworkReason(e.target.value)}
              rows={4}
              placeholder={isKo ? "예: 스티커 위치 불량, 디자인 오인쇄 등" : "例如：贴纸位置不良、设计误印等"}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setReworkTarget(null)}>{isKo ? "취소" : "取消"}</Button>
              <Button
                size="sm"
                disabled={!reworkReason.trim() || reworkSaving}
                onClick={async () => {
                  if (!reworkTarget) return;
                  setReworkSaving(true);
                  try {
                    await reworkItem(reworkTarget.seq, reworkReason.trim());
                    setReworkTarget(null);
                  } finally {
                    setReworkSaving(false);
                  }
                }}
              >
                {reworkSaving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                {isKo ? "재작업 시작" : "开始返工"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

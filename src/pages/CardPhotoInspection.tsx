import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Camera, CheckCircle2, XCircle, RotateCcw, ChevronLeft, Image as ImageIcon,
  ScanLine, AlertTriangle, Loader2, Trash2,
} from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";

interface CardItem {
  card_barcode: string;
  /** DM 바코드 기준값 = 개별 주문번호 + "-4" */
  dm_expected: string;
  card_serial: string;
  card_grade: string;
  design_qr: string;
  hologram_qr: string;
  twinker: string;
  cp_score?: string | number;
  edition?: string | number;
  minted_on?: string | number;
  sign?: string;
  twincode?: string;
  /** 등록된 트윈코드 이미지(SVG) URL — 형태 비교용 */
  twincode_url?: string;
  /** GFT 원본 이미지 URL (주문 데이터에 직접 저장된 값) */
  gft_url?: string;

}


interface OrderRow {
  id: string;
  externalOrderId: string;
  twinker: string;
  product: string;
  dueDate: string;
  items: CardItem[];
}

type FrontExtract = { cp_score: string; edition: string; notes?: string };
type BackExtract = {
  issued_no: string; minted_on: string; card_grade: string; twincode: string; dm_barcode: string;
  twincode_shape_match?: boolean; twincode_shape_note?: string; notes?: string;
};


interface FieldCheck {
  label: string;
  expected: string;
  detected: string;
  match: boolean;
}

type Tfn = (ko: string, zh: string) => string;
const VISUAL_FIELDS: {
  key: string;
  side: "front" | "back";
  label: (t: Tfn) => string;
  getExpected: (e: CardItem) => string;
  getDetected: (r: any) => string;
}[] = [
  { key: "cp", side: "front", label: t => t("CP 점수", "CP分数"),
    getExpected: e => String(e.cp_score ?? ""), getDetected: r => r.cp_score ?? "" },
  { key: "edition", side: "front", label: () => "EDITION",
    getExpected: e => String(e.edition ?? ""), getDetected: r => r.edition ?? "" },
  { key: "issued", side: "back", label: () => "ISSUED No.",
    getExpected: e => e.card_serial ?? "", getDetected: r => r.issued_no ?? "" },
  { key: "minted", side: "back", label: () => "Minted on",
    getExpected: e => String(e.minted_on ?? ""), getDetected: r => r.minted_on ?? "" },
  { key: "grade", side: "back", label: t => t("카드 등급", "卡片等级"),
    getExpected: e => e.card_grade ?? "", getDetected: r => r.card_grade ?? "" },
  { key: "twin", side: "back", label: t => t("트윈코드", "TwinCode"),
    getExpected: e => e.twincode || e.design_qr || "", getDetected: r => r.twincode ?? "" },
  { key: "dm", side: "back", label: t => t("DM 바코드", "DM条码"),
    getExpected: e => e.card_barcode ?? "", getDetected: r => r.dm_barcode ?? "" },
];

export default function CardPhotoInspection() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const t = (ko: string, zh: string) => (isKo ? ko : zh);

  const { data: dbOrders } = useOrders();
  const orders = useMemo<OrderRow[]>(() => {
    if (!dbOrders) return [];
    return dbOrders.map((o: any) => {
      const sd: any = o.source_data ?? {};
      const items: CardItem[] = (sd.items ?? []).map((it: any, idx: number) => ({
        card_barcode: it.card_barcode ?? it.dm_barcode ?? it.dm_code ?? it.nfc_ndef_data ?? "",
        // DM 바코드 기준값 = 개별 주문번호 + "-4" (카드 바코드 인쇄 작업과 동일 규칙)
        dm_expected: `${String(it.order_id ?? it.sequence_no ?? `${o.external_order_id}-${idx + 1}`)}-4`,
        card_serial: it.card_serial ?? it.issued_no ?? sd.issued_no ?? "",
        card_grade: it.card_grade ?? it.grade ?? sd.grade ?? "",
        design_qr: it.design_qr ?? "",
        hologram_qr: it.hologram_qr ?? "",
        twinker: it.twinker ?? o.recipient_name ?? "",
        // 엑셀 업로드 데이터는 cp_value(예: "CP 230") 키를 사용한다.
        cp_score:
          it.cp_score ?? it.cp_value ?? it.cp ?? it.cpValue ?? it.CP ?? it.cp_no ?? it.cpNo ??
          sd.cp_score ?? sd.cp_value ?? sd.cp ?? sd.cpValue ?? sd.CP ?? "",
        edition: it.edition ?? it.edition_no ?? it.editionNo ?? sd.edition_no ?? String(idx + 1),
        minted_on: it.minted_on ?? sd.minted_on,
        sign: it.sign,
        twincode: it.twincode ?? it.twin_code ?? it.design_qr ?? "",
        twincode_url: it.twincode_svg_url ?? it.twincode_url ?? it.twin_code_url ?? sd.twincode_svg_url ?? "",

        gft_url:
          it.gft_original_image_url ?? sd.gft_original_image_url ??
          it.card_front_url ?? sd.card_front_url ??
          it.gft_image_url ?? it.design_image_url ?? o.logo_url ?? "",
      }));


      return {
        id: o.id,
        externalOrderId: o.external_order_id,
        twinker: o.recipient_name,
        product: o.product_code,
        dueDate: o.project_completed_at
          ? new Date(o.project_completed_at).toLocaleDateString(isKo ? "ko-KR" : "zh-CN")
          : "-",
        items,
      };
    });
  }, [dbOrders, isKo]);

  // ── Step 1: order selection (manual or auto via DM barcode) ────────────
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedItemIdx, setSelectedItemIdx] = useState<number>(0);
  const order = orders.find(o => o.id === selectedOrderId) ?? null;
  const expected = order?.items[selectedItemIdx];

  const { data: designImages } = useQuery({
    queryKey: ["card-photo-design", order?.externalOrderId],
    enabled: !!order?.externalOrderId,
    queryFn: async () => {
      const folder = order!.externalOrderId;
      const map: Record<string, string> = {};
      const list: string[] = [];
      const { data: files } = await supabase.storage.from("design-images").list(folder);
      if (files) {
        for (const f of files) {
          const url = supabase.storage.from("design-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
          const k = f.name.replace(/\.[^.]+$/, "");
          map[k] = url;
          map[k.toLowerCase()] = url;
          list.push(url);
        }
      }
      return { map, list };
    },
  });

  const expectedDesignUrl = useMemo(() => {
    if (!expected) return undefined;
    // 1) 주문 데이터에 저장된 GFT 원본 URL 우선
    if (expected.gft_url) return expected.gft_url;
    const map = designImages?.map ?? {};
    const keys = [expected.design_qr, expected.twincode, expected.card_serial, expected.card_barcode]
      .filter(Boolean) as string[];
    for (const k of keys) {
      if (map[k]) return map[k];
      if (map[k.toLowerCase()]) return map[k.toLowerCase()];
    }
    // 2) 파일명 매칭 실패 시 카드 순번으로 폴백
    return designImages?.list?.[selectedItemIdx] ?? designImages?.list?.[0];
  }, [expected, designImages, selectedItemIdx]);


  // ── Auto-match by DM barcode ──────────────────────────────────────────
  const [dmInput, setDmInput] = useState("");
  const handleDmLookup = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    for (const o of orders) {
      const idx = o.items.findIndex(it => it.card_barcode === code);
      if (idx >= 0) {
        setSelectedOrderId(o.id);
        setSelectedItemIdx(idx);
        toast.success(t(`주문 ${o.externalOrderId} 카드 ${idx + 1} 매칭`, `订单 ${o.externalOrderId} 卡片 ${idx + 1} 已匹配`));
        setDmInput("");
        return;
      }
    }
    toast.error(t("DM 바코드와 일치하는 카드가 없습니다", "未找到匹配DM条码的卡片"));
  }, [orders, isKo]);

  // ── Camera ─────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");

  const startCamera = useCallback(async (id?: string) => {
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter(d => d.kind === "videoinput");
      setDevices(cams);
      if (!deviceId && cams[0]) setDeviceId(cams[0].deviceId);
    } catch (e: any) {
      toast.error(t("카메라 접근 실패: " + (e?.message ?? ""), "无法访问摄像头: " + (e?.message ?? "")));
    }
  }, [stream, deviceId, isKo]);

  useEffect(() => () => { stream?.getTracks().forEach(t => t.stop()); }, [stream]);

  const captureDataUrl = (): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  // ── Inspection state ──────────────────────────────────────────────────
  const [frontImg, setFrontImg] = useState<string | null>(null);
  const [backImg, setBackImg] = useState<string | null>(null);
  const [frontResult, setFrontResult] = useState<FrontExtract | null>(null);
  const [backResult, setBackResult] = useState<BackExtract | null>(null);
  const [busySide, setBusySide] = useState<"front" | "back" | null>(null);
  /** Result of matching the FRONT photo (CP + EDITION) against order data. */
  const [frontMatch, setFrontMatch] = useState<"idle" | "matched" | "failed">("idle");
  /** 뒷면 사진에서 실제 디코딩된 DM 바코드 값 */
  const [dmDecoded, setDmDecoded] = useState<string>("");


  const normKey = (v: any) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const digits = (v: any) => String(v ?? "").replace(/\D/g, "");
  /** "EDITION 3/8", "#3", "03" → "3" (compare only the edition number itself). */
  const edNum = (v: any) => {
    const s = String(v ?? "").replace(/edition/gi, "").trim();
    const m = s.match(/\d+/);
    return m ? String(parseInt(m[0], 10)) : "";
  };

  /** Find a card whose CP score AND edition both match the detected front values. */
  const findByFront = useCallback((cp: string, ed: string) => {
    const cpD = digits(cp);
    const edN = edNum(ed);
    if (!cpD && !edN) return null;
    const pool = order ? [order] : orders;
    // 1) CP + EDITION both match  2) EDITION only  3) CP only (single candidate)
    const matchers: ((it: CardItem) => boolean)[] = [
      it => !!cpD && !!edN && digits(it.cp_score) === cpD && edNum(it.edition) === edN,
      it => !!edN && edNum(it.edition) === edN,
      it => !!cpD && digits(it.cp_score) === cpD,
    ];
    for (const fn of matchers) {
      for (const o of pool) {
        const hits = o.items.map((it, i) => (fn(it) ? i : -1)).filter(i => i >= 0);
        if (hits.length === 1) return { o, idx: hits[0] };
        // 여러 장이 같은 값이면 현재 선택된 카드가 후보에 있으면 그것을 사용
        if (hits.length > 1) {
          if (o.id === order?.id && hits.includes(selectedItemIdx)) return { o, idx: selectedItemIdx };
          return { o, idx: hits[0] };
        }
      }
    }
    return null;
  }, [orders, order, selectedItemIdx]);


  /** DM(Data Matrix) 바코드를 실제로 디코딩해 "값" 기준으로 판정한다. */
  const decodeDataMatrix = async (dataUrl: string): Promise<string> => {
    try {
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");
      const hints = new Map<any, any>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints as any);
      const res = await reader.decodeFromImageUrl(dataUrl);
      return res?.getText?.()?.trim() ?? "";
    } catch {
      return "";
    }
  };

  // The AI model cannot read SVG URLs, so rasterize the registered TwinCode to PNG.
  const toRasterDataUrl = async (url: string): Promise<string | undefined> => {
    if (!url) return undefined;
    if (!/\.svg($|\?)/i.test(url) && !url.startsWith("data:image/svg")) return url;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("load failed"));
        img.src = url;
      });
      const size = 512;
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return undefined;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL("image/png");
    } catch {
      return undefined;
    }
  };

  const inspectImage = async (side: "front" | "back", dataUrl: string) => {
    setBusySide(side);
    try {
      const referenceTwincode = side === "back" ? await toRasterDataUrl(expected?.twincode_url || "") : undefined;

      const [{ data, error }, decodedDm] = await Promise.all([
        supabase.functions.invoke("card-photo-inspect", {
          body: { side, image: dataUrl, reference_twincode: referenceTwincode },
        }),
        side === "back" ? decodeDataMatrix(dataUrl) : Promise.resolve(""),
      ]);
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const ex = data?.extracted;
      if (!ex) throw new Error(t("추출 결과 없음", "无提取结果"));
      if (side === "back") {
        setDmDecoded(decodedDm);
        if (decodedDm) ex.dm_barcode = decodedDm;
      }

      if (side === "front") {
        setFrontResult(ex);
        // Match the order/card by CP score + EDITION number.
        const hit = findByFront(ex.cp_score, ex.edition);
        if (hit) {
          setSelectedOrderId(hit.o.id);
          setSelectedItemIdx(hit.idx);
          setFrontMatch("matched");
          toast.success(t(
            `주문 ${hit.o.externalOrderId} 카드 ${hit.idx + 1} 매칭 (CP ${ex.cp_score} · EDITION ${ex.edition})`,
            `订单 ${hit.o.externalOrderId} 卡片 ${hit.idx + 1} 已匹配 (CP ${ex.cp_score} · EDITION ${ex.edition})`));
        } else {
          setFrontMatch("failed");
          toast.error(t("CP/EDITION과 일치하는 주문 카드가 없습니다", "未找到与CP/EDITION一致的订单卡片"));
        }
      } else {
        setBackResult(ex);
        // Auto-match order by detected DM barcode
        const dm = String(ex.dm_barcode ?? "").trim();
        if (dm && !selectedOrderId) {
          for (const o of orders) {
            const idx = o.items.findIndex(it => it.card_barcode === dm);
            if (idx >= 0) {
              setSelectedOrderId(o.id);
              setSelectedItemIdx(idx);
              toast.success(t(`주문 ${o.externalOrderId} 카드 ${idx + 1} 자동 매칭`, `订单 ${o.externalOrderId} 卡片 ${idx + 1} 自动匹配`));
              break;
            }
          }
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Inspection failed");
    } finally {
      setBusySide(null);
    }
  };

  const captureSide = async (side: "front" | "back") => {
    const url = captureDataUrl();
    if (!url) {
      toast.error(t("카메라가 준비되지 않았습니다", "摄像头未准备好"));
      return;
    }
    if (side === "front") { setFrontImg(url); setFrontResult(null); setFrontMatch("idle"); }
    else { setBackImg(url); setBackResult(null); setDmDecoded(""); }
    await inspectImage(side, url);
  };

  const reset = () => {
    setFrontImg(null); setBackImg(null);
    setFrontResult(null); setBackResult(null); setDmDecoded("");
    setFrontMatch("idle");
  };


  // ── Comparison (text fields only) ─────────────────────────────────────
  const norm = (v: any) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

  /** 등급 표기 흔들림(Legendary/레전드/S등급 등)을 표준 등급명으로 정규화 */
  const gradeNorm = (v: any) => {
    const s = norm(v).replace(/[^a-z가-힣]/g, "");
    if (!s) return "";
    const table: [RegExp, string][] = [
      [/legend|레전드|전설/, "legend"],
      [/epic|에픽/, "epic"],
      [/unique|유니크/, "unique"],
      [/uncommon|언커먼/, "uncommon"],
      [/rare|레어|희귀/, "rare"],
      [/common|커먼|일반/, "common"],
    ];
    for (const [re, key] of table) if (re.test(s)) return key;
    return s;
  };


  const checks: FieldCheck[] = useMemo(() => {
    if (!expected) return [];
    const list: FieldCheck[] = [];
    if (frontResult) {
      list.push({
        label: t("CP 점수", "CP分数"),
        expected: String(expected.cp_score ?? ""),
        detected: frontResult.cp_score ?? "",
        match: norm(expected.cp_score).replace(/\D/g, "") === norm(frontResult.cp_score).replace(/\D/g, "")
          && !!norm(expected.cp_score),
      });
      list.push({
        label: "EDITION",
        expected: String(expected.edition ?? ""),
        detected: frontResult.edition ?? "",
        match: !!edNum(expected.edition) && edNum(expected.edition) === edNum(frontResult.edition),
      });
    }
    if (backResult) {
      list.push({
        label: "ISSUED No.",
        expected: expected.card_serial ?? "",
        detected: backResult.issued_no ?? "",
        match: !!expected.card_serial && norm(backResult.issued_no).includes(norm(expected.card_serial)),
      });
      list.push({
        label: "Minted on",
        expected: String(expected.minted_on ?? ""),
        detected: backResult.minted_on ?? "",
        match: norm(expected.minted_on) === norm(backResult.minted_on) && !!norm(expected.minted_on),
      });
      list.push({
        label: t("카드 등급", "卡片等级"),
        expected: expected.card_grade ?? "",
        detected: backResult.card_grade ?? "",
        match: !!gradeNorm(expected.card_grade) && gradeNorm(expected.card_grade) === gradeNorm(backResult.card_grade),
      });
      {
        const shape = backResult.twincode_shape_match === true;
        list.push({
          label: t("트윈코드 (형태 비교)", "TwinCode (形状比对)"),
          expected: expected.twincode_url
            ? t("등록된 트윈코드 형태", "已登记TwinCode形状")
            : t("등록 이미지 없음", "无已登记图像"),
          detected: expected.twincode_url
            ? (shape ? t("형태 일치", "形状一致") : t("형태 불일치", "形状不一致"))
            : t("비교 불가", "无法比对"),
          match: !!expected.twincode_url && shape,
        });
      }
      {
        const expDm = norm(expected.card_barcode);
        const gotDm = norm(dmDecoded || backResult.dm_barcode);
        list.push({
          label: t("DM 바코드 (값 비교)", "DM条码 (值比对)"),
          expected: expected.card_barcode ?? "",
          detected: dmDecoded || backResult.dm_barcode || t("디코딩 실패", "解码失败"),
          match: !!expDm && !!gotDm && expDm === gotDm,
        });
      }

    }
    return list;
  }, [expected, frontResult, backResult, dmDecoded, isKo]);

  const failCount = checks.filter(c => !c.match).length;
  const allDone = !!frontResult && !!backResult;

  // ── Inspection history (persisted in localStorage) ────────────────────
  type HistoryField = { label: string; expected: string; detected: string; match: boolean };
  type HistoryEntry = {
    key: string;             // orderId + itemIdx
    orderId: string;
    externalOrderId: string;
    itemIdx: number;
    cardSerial: string;
    dmBarcode: string;
    pass: boolean;
    failCount: number;
    fields?: HistoryField[];
    at: number;              // epoch ms
  };
  const HISTORY_KEY = "card-photo-inspect-history";
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  }, [history]);

  const recordedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!allDone || !order || !expected) return;
    const key = `${order.id}::${selectedItemIdx}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    const entry: HistoryEntry = {
      key,
      orderId: order.id,
      externalOrderId: order.externalOrderId,
      itemIdx: selectedItemIdx,
      cardSerial: expected.card_serial ?? "",
      dmBarcode: expected.card_barcode ?? "",
      pass: failCount === 0,
      failCount,
      fields: checks.map(c => ({ label: c.label, expected: c.expected, detected: c.detected, match: c.match })),
      at: Date.now(),
    };
    setHistory(prev => [entry, ...prev.filter(h => h.key !== key)]);
  }, [allDone, order, expected, selectedItemIdx, failCount, checks]);


  const orderHistory = useMemo(
    () => history.filter(h => order && h.orderId === order.id),
    [history, order]
  );

  // ── Random sampling plan: consecutive 3 cards, rounds by order size ────
  // ≤5장 → 1회, ≤10장 → 2회, 그 외 → 3회
  const RUN = 3;
  const roundsFor = (total: number) => (total <= 5 ? 1 : total <= 10 ? 2 : 3);
  const PLAN_KEY = "card-photo-sample-plans";
  const [plans, setPlans] = useState<Record<string, number[]>>(() => {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plans)); } catch {}
  }, [plans]);

  const buildPlan = useCallback((total: number): number[] => {
    if (total <= 0) return [];
    if (total < RUN) return [0];
    const maxStart = total - RUN;
    const want = Math.min(roundsFor(total), Math.floor(total / RUN));
    const starts: number[] = [];
    let guard = 0;
    while (starts.length < want && guard++ < 500) {
      const s = Math.floor(Math.random() * (maxStart + 1));
      if (starts.every(x => Math.abs(x - s) >= RUN)) starts.push(s);
    }
    return starts.sort((a, b) => a - b);
  }, []);


  // Ensure a plan exists for the opened order
  useEffect(() => {
    if (!order) return;
    if (plans[order.id]?.length) return;
    const p = buildPlan(order.items.length);
    if (p.length) setPlans(prev => ({ ...prev, [order.id]: p }));
  }, [order, plans, buildPlan]);

  const planStarts = order ? (plans[order.id] ?? []) : [];
  const sampleRounds = useMemo(
    () => planStarts.map(s => Array.from({ length: Math.min(RUN, (order?.items.length ?? 0) - s) }, (_, k) => s + k)),
    [planStarts, order]
  );
  const sampleIdxs = useMemo(() => sampleRounds.flat(), [sampleRounds]);
  const sampleDone = sampleIdxs.filter(i => orderHistory.some(h => h.itemIdx === i));
  const samplePass = sampleIdxs.filter(i => orderHistory.some(h => h.itemIdx === i && h.pass));
  const sampleFail = sampleIdxs.filter(i => orderHistory.some(h => h.itemIdx === i && !h.pass));
  const sampleComplete = sampleIdxs.length > 0 && sampleDone.length === sampleIdxs.length;
  const finalPass = sampleComplete && sampleFail.length === 0;

  const reshufflePlan = () => {
    if (!order) return;
    const p = buildPlan(order.items.length);
    setPlans(prev => ({ ...prev, [order.id]: p }));
    if (p[0] !== undefined) setSelectedItemIdx(p[0]);
    reset();
    toast.success(t("표본을 다시 추첨했습니다", "已重新抽取样本"));
  };

  const goToNextCard = () => {
    if (!order) return;
    const nextPending = sampleIdxs.find(i =>
      i !== selectedItemIdx && !orderHistory.some(h => h.itemIdx === i));
    reset();
    if (nextPending !== undefined) setSelectedItemIdx(nextPending);
    else toast.success(t(`표본 검사 ${sampleRounds.length}회(${sampleIdxs.length}장)가 모두 완료되었습니다`, `${sampleRounds.length} 轮抽检(${sampleIdxs.length} 张)已全部完成`));
  };

  const removeHistory = (key: string) => {
    recordedRef.current.delete(key);
    setHistory(prev => prev.filter(h => h.key !== key));
  };


  // ── Order selection view ──────────────────────────────────────────────
  if (!order) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title={t("카드 사진 검사", "卡片照片检验")}
          description={t("카드 앞·뒷면을 촬영해 주문 정보와 일치 여부를 자동 확인합니다", "拍摄卡片正反面自动验证与订单信息的一致性")}
        />
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* DM auto-match */}
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2">
              <ScanLine className="w-4 h-4" /> {t("DM 바코드로 자동 매칭", "通过DM条码自动匹配")}
            </div>
            <div className="flex gap-2">
              <Input
                value={dmInput}
                onChange={e => setDmInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleDmLookup(dmInput); } }}
                placeholder={t("DM 바코드를 스캔하거나 입력하세요", "扫描或输入DM条码")}
              />
              <Button onClick={() => handleDmLookup(dmInput)}>{t("매칭", "匹配")}</Button>
            </div>
          </div>

          {/* Manual selection */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold">
              {t("주문 선택", "选择订单")}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{t("주문번호", "订单号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("트윈커", "Twinker")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("상품", "商品")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("카드 수량", "卡片数量")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("표본 검사 (연속 3장 단위)", "抽检 (每轮连续3张)")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("납기", "交期")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => {
                  const total = o.items.length;
                  const starts = plans[o.id] ?? [];
                  const idxs = starts.flatMap(s => Array.from({ length: Math.min(3, total - s) }, (_, k) => s + k));
                  const target = idxs.length || Math.min(roundsFor(total) * 3, total);
                  const oh = history.filter(h => h.orderId === o.id && idxs.includes(h.itemIdx));
                  const pass = oh.filter(h => h.pass).length;
                  const fail = oh.filter(h => !h.pass).length;
                  const done = oh.length;
                  const pct = target > 0 ? Math.round((done / target) * 100) : 0;
                  return (
                    <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer"
                      onClick={() => { setSelectedOrderId(o.id); setSelectedItemIdx((plans[o.id] ?? [0])[0] ?? 0); }}>
                      <td className="px-4 py-3 font-medium text-primary hover:underline">{o.externalOrderId}</td>
                      <td className="px-4 py-3">{o.twinker}</td>
                      <td className="px-4 py-3">{o.product}</td>
                      <td className="px-4 py-3 tabular-nums">{total}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{done}/{target}</span>

                          {pass > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">✓{pass}</span>}
                          {fail > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]">!{fail}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">{o.dueDate}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline">{t("선택", "选择")}</Button>
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{t("주문이 없습니다", "暂无订单")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Inspection view ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title={t("카드 사진 검사", "卡片照片检验")}
        description={`${order.externalOrderId} · ${order.twinker} · ${t(`카드 ${selectedItemIdx + 1}/${order.items.length}`, `卡片 ${selectedItemIdx + 1}/${order.items.length}`)}`}
      >
        <Button variant="outline" size="sm" onClick={() => { setSelectedOrderId(null); reset(); }}>
          <ChevronLeft className="w-4 h-4" /> {t("주문 목록", "订单列表")}
        </Button>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="w-4 h-4" /> {t("초기화", "重置")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Random sampling plan — 3 rounds × 3 consecutive cards */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center justify-between gap-2 flex-wrap">
            <span>
              {t(`랜덤 표본 검사 (연속 3장 × ${sampleRounds.length}회)`, `随机抽检 (连续3张 × ${sampleRounds.length}轮)`)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t(`전체 ${order.items.length}장 중 ${sampleIdxs.length}장 검사`, `共 ${order.items.length} 张中抽检 ${sampleIdxs.length} 张`)}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {t(`완료 ${sampleDone.length}/${sampleIdxs.length}`, `已完成 ${sampleDone.length}/${sampleIdxs.length}`)}
                {samplePass.length > 0 && ` · ✓${samplePass.length}`}
                {sampleFail.length > 0 && ` · ✗${sampleFail.length}`}
              </span>
              <Button size="sm" variant="outline" onClick={reshufflePlan}>
                <RotateCcw className="w-3.5 h-3.5" /> {t("표본 재추첨", "重新抽样")}
              </Button>
            </div>
          </div>

          {sampleIdxs.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("검사할 카드가 없습니다", "无可检验卡片")}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3">
              {sampleRounds.map((round, ri) => {
                const rDone = round.filter(i => orderHistory.some(h => h.itemIdx === i)).length;
                const rFail = round.filter(i => orderHistory.some(h => h.itemIdx === i && !h.pass)).length;
                const roundState = rDone < round.length ? "pending" : rFail > 0 ? "fail" : "pass";
                return (
                  <div key={ri} className={`rounded-lg border p-3 ${
                    roundState === "pass" ? "border-[hsl(var(--success)/0.5)] bg-[hsl(var(--success)/0.06)]"
                    : roundState === "fail" ? "border-destructive/50 bg-destructive/5"
                    : "border-border bg-muted/10"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold">
                        {t(`${ri + 1}회차`, `第 ${ri + 1} 轮`)}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          #{round[0] + 1}~#{round[round.length - 1] + 1}
                        </span>
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{rDone}/{round.length}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {round.map(idx => {
                        const it = order.items[idx];
                        const h = orderHistory.find(x => x.itemIdx === idx);
                        const status: "pending" | "pass" | "fail" = !h ? "pending" : h.pass ? "pass" : "fail";
                        const isActive = idx === selectedItemIdx;
                        const styles = {
                          pending: "border-border bg-muted/20 text-muted-foreground",
                          pass: "border-[hsl(var(--success)/0.5)] bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]",
                          fail: "border-destructive/50 bg-destructive/10 text-destructive",
                        }[status];
                        return (
                          <button
                            key={idx}
                            onClick={() => { setSelectedItemIdx(idx); reset(); }}
                            className={`rounded-lg border p-2 text-left transition-all ${styles} ${isActive ? "ring-2 ring-primary" : ""}`}
                            title={it?.card_serial || it?.card_barcode}
                          >
                            <div className="text-[10px] font-semibold opacity-70">#{idx + 1}</div>
                            <div className="text-[10px] font-mono truncate">{it?.card_serial || "-"}</div>
                            <div className="text-[10px] opacity-70">
                              {status === "pending" ? t("대기", "等待") : status === "pass" ? t("합격", "合格") : t("불합격", "不合格")}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Final sampling verdict */}
        {sampleComplete && (
          <div className={`rounded-lg border p-4 flex items-center gap-3 ${
            finalPass
              ? "bg-[hsl(var(--success)/0.1)] border-[hsl(var(--success)/0.4)] text-[hsl(var(--success))]"
              : "bg-destructive/10 border-destructive/40 text-destructive"}`}>
            {finalPass ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
            <div>
              <div className="font-semibold">
                {finalPass
                  ? t(`최종 통과 — 표본 ${sampleRounds.length}회(연속 3장) 검사 완료`, `最终通过 — ${sampleRounds.length} 轮抽检(连续3张)已完成`)
                  : t(`최종 불합격 — 표본 중 ${sampleFail.length}장 불일치`, `最终不合格 — 抽检中 ${sampleFail.length} 张不一致`)}
              </div>
              <div className="text-sm opacity-90">
                {finalPass
                  ? t("카드 순서와 인쇄 데이터가 정상으로 확인되었습니다.", "卡片顺序与印刷数据确认正常。")
                  : t("불합격 카드를 확인하고 재검사하거나 표본을 재추첨하세요.", "请确认不合格卡片并复检或重新抽样。")}
              </div>
            </div>
          </div>
        )}


        {/* Camera */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Camera className="w-4 h-4" /> {t("카메라", "摄像头")}
            </div>
            <div className="flex items-center gap-2">
              {devices.length > 1 && (
                <select
                  className="text-xs rounded border bg-background px-2 py-1"
                  value={deviceId}
                  onChange={e => { setDeviceId(e.target.value); startCamera(e.target.value); }}
                >
                  {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}
                </select>
              )}
              {!stream ? (
                <Button size="sm" onClick={() => startCamera()}>{t("카메라 시작", "启动摄像头")}</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => { stream.getTracks().forEach(t => t.stop()); setStream(null); }}>
                  {t("중지", "停止")}
                </Button>
              )}
            </div>
          </div>
          <div className="aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
          </div>
          <div className="text-xs text-muted-foreground mt-3 mb-2">
            {t("① 앞면을 먼저 촬영하면 CP 점수와 EDITION으로 주문 카드가 자동 매칭됩니다. ② 그 다음 뒷면을 촬영하세요.", "① 先拍摄正面，通过CP分数与EDITION自动匹配订单卡片。② 然后拍摄背面。")}
          </div>

          {/* Front match status (requirement: green when matched, red when not) */}
          {frontMatch !== "idle" && (
            <div className={`mb-3 rounded-lg border p-3 flex items-center gap-3 ${
              frontMatch === "matched"
                ? "bg-[hsl(var(--success)/0.1)] border-[hsl(var(--success)/0.4)] text-[hsl(var(--success))]"
                : "bg-destructive/10 border-destructive/40 text-destructive"
            }`}>
              {frontMatch === "matched" ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              <div className="text-sm">
                <div className="font-semibold">
                  {frontMatch === "matched"
                    ? t("주문 매칭 통과 (CP · EDITION)", "订单匹配通过 (CP · EDITION)")
                    : t("주문 매칭 실패 (CP · EDITION)", "订单匹配失败 (CP · EDITION)")}
                </div>
                <div className="opacity-90 font-mono text-xs">
                  CP {frontResult?.cp_score || "-"} · EDITION {frontResult?.edition || "-"}
                  {frontMatch === "matched" && order ? ` → ${order.externalOrderId} #${selectedItemIdx + 1}` : ""}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => captureSide("front")} disabled={!stream || busySide !== null}>
              {busySide === "front" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {t("① 앞면 촬영 & 분석", "① 拍摄并分析正面")}
            </Button>
            <Button onClick={() => captureSide("back")} disabled={!stream || busySide !== null} variant="secondary">
              {busySide === "back" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {t("② 뒷면 촬영 & 분석", "② 拍摄并分析背面")}
            </Button>
          </div>

        </div>

        {/* Result banner */}
        {allDone && (
          <div className={`rounded-lg border p-4 flex items-center gap-3 ${
            failCount === 0
              ? "bg-[hsl(var(--success)/0.1)] border-[hsl(var(--success)/0.3)] text-[hsl(var(--success))]"
              : "bg-[hsl(var(--warning)/0.1)] border-[hsl(var(--warning)/0.3)] text-[hsl(var(--warning))]"
          }`}>
            {failCount === 0 ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            <div>
              <div className="font-semibold">
                {failCount === 0
                  ? t("모든 텍스트 항목 일치", "所有文本字段一致")
                  : t(`텍스트 항목 ${failCount}개 불일치 — 작업자 확인 필요`, `${failCount} 个文本字段不一致 — 请操作员确认`)}
              </div>
              <div className="text-sm opacity-90">
                {t("이미지 및 서명은 우측의 등록 자료를 보고 작업자가 직접 판단해 주세요.", "图像和签名请操作员对照右侧已登记资料判断。")}
              </div>
            </div>
          </div>
        )}

        {/* Visual reference (image + signature) for human judgement */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`rounded-lg border bg-card overflow-hidden ${frontMatch === "matched" ? "border-[hsl(var(--success)/0.5)] ring-1 ring-[hsl(var(--success)/0.3)]" : ""}`}>
            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> {t("등록된 GFT 이미지 (작업자 비교용)", "已登记GFT图像 (供操作员对比)")}
              {frontMatch === "matched" && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">
                  {t(`매칭 #${selectedItemIdx + 1}`, `匹配 #${selectedItemIdx + 1}`)}
                </span>
              )}
            </div>
            <div className="aspect-[3/4] bg-muted/20 flex items-center justify-center">
              {frontMatch !== "matched" ? (
                <div className="text-muted-foreground text-sm text-center px-4">
                  {t("앞면 촬영 & 분석 후 표시됩니다", "拍摄并分析正面后显示")}
                </div>
              ) : expectedDesignUrl ? (
                <img src={expectedDesignUrl} alt={t("등록된 GFT 이미지", "已登记GFT图像")} className="w-full h-full object-contain" />
              ) : (
                <div className="text-muted-foreground text-sm">{t("등록 이미지 없음", "无已登记图像")}</div>
              )}
            </div>


            {frontMatch === "matched" && expected?.sign && (
              <div className="px-4 py-3 border-t">
                <div className="text-xs text-muted-foreground mb-1">{t("등록된 서명", "已登记签名")}</div>
                <div className="text-2xl font-serif italic">{expected.sign}</div>
              </div>
            )}
          </div>

          {/* Captured photos */}
          <div className="space-y-4">
            <CapturedCard
              label={t("앞면 촬영", "正面拍摄")}
              img={frontImg}
              busy={busySide === "front"}
              onDelete={() => { setFrontImg(null); setFrontResult(null); }}
            />
            <CapturedCard
              label={t("뒷면 촬영", "背面拍摄")}
              img={backImg}
              busy={busySide === "back"}
              onDelete={() => { setBackImg(null); setBackResult(null); }}
            />
          </div>
        </div>

        {/* Field comparison — visual cards */}
        {expected && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center justify-between">
              <span>{t("검사 항목", "检验项目")}</span>
              <span className="text-xs text-muted-foreground">
                {t(`총 ${VISUAL_FIELDS.length}개 · 일치 ${checks.filter(c=>c.match).length} · 불일치 ${checks.filter(c=>!c.match).length} · 대기 ${VISUAL_FIELDS.length - checks.length}`,
                   `共 ${VISUAL_FIELDS.length} · 一致 ${checks.filter(c=>c.match).length} · 不一致 ${checks.filter(c=>!c.match).length} · 等待 ${VISUAL_FIELDS.length - checks.length}`)}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
              {VISUAL_FIELDS.map(f => {
                const side = f.side;
                const ready = side === "front" ? !!frontResult : !!backResult;
                const check = checks.find(c => c.label === f.label(t));
                const status: "pending" | "match" | "fail" = !ready ? "pending" : check?.match ? "match" : "fail";
                const expectedVal = f.getExpected(expected);
                const detectedVal = ready
                  ? (side === "front" ? f.getDetected(frontResult!) : f.getDetected(backResult!))
                  : "";
                const styles = {
                  pending: "border-border bg-muted/20",
                  match: "border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.08)]",
                  fail: "border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)]",
                }[status];
                return (
                  <div key={f.key} className={`rounded-lg border p-3 ${styles}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {side === "front" ? t("앞면", "正面") : t("뒷면", "背面")}
                      </span>
                      {status === "pending" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t("대기", "等待")}</span>}
                      {status === "match" && <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] text-sm font-bold">O</span>}
                      {status === "fail" && <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] text-sm font-bold">X</span>}
                    </div>
                    <div className="text-sm font-semibold mb-2">{f.label(t)}</div>
                    <div className="space-y-1 text-xs">
                      <div>
                        <div className="text-muted-foreground text-[10px] uppercase">{t("기준", "标准")}</div>
                        <div className="font-mono break-all">{expectedVal || "-"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px] uppercase">{t("추출", "提取")}</div>
                        <div className="font-mono break-all">{ready ? (detectedVal || "-") : "…"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inspection history for this order */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center justify-between">
            <span>
              {t("이 주문 검사 기록", "本订单检验记录")}
              <span className="ml-2 text-xs text-muted-foreground">
                {t(`표본 완료 ${sampleDone.length}/${sampleIdxs.length}`, `抽检完成 ${sampleDone.length}/${sampleIdxs.length}`)}
              </span>
            </span>
            {allDone && !sampleComplete && (
              <Button size="sm" variant="outline" onClick={goToNextCard}>
                {t("다음 표본 카드", "下一张抽检卡片")}
              </Button>
            )}

          </div>
          {orderHistory.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("아직 검사 기록이 없습니다", "暂无检验记录")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">{t("카드 순번", "卡片序号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("DM 바코드", "DM条码")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("검사 항목", "检验项目")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("결과", "结果")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("시각", "时间")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orderHistory.map(h => (
                  <tr key={h.key} className="border-t hover:bg-muted/20 align-top">
                    <td className="px-4 py-2 tabular-nums">{h.itemIdx + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs">{h.cardSerial || "-"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{h.dmBarcode || "-"}</td>
                    <td className="px-4 py-2">
                      {h.fields?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {h.fields.map((f, i) => (
                            <span
                              key={i}
                              title={`${t("기준", "标准")}: ${f.expected || "-"} / ${t("추출", "提取")}: ${f.detected || "-"}`}
                              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                                f.match
                                  ? "border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]"
                                  : "border-destructive/40 bg-destructive/10 text-destructive"
                              }`}
                            >
                              {f.match ? "O" : "X"} {f.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {h.pass ? (
                        <span className="inline-flex items-center gap-1 text-[hsl(var(--success))] text-xs font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> {t("합격", "合格")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive text-xs font-semibold">
                          <XCircle className="w-3.5 h-3.5" /> {t(`불일치 ${h.failCount}`, `不一致 ${h.failCount}`)}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(h.at).toLocaleString(isKo ? "ko-KR" : "zh-CN")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => removeHistory(h.key)}
                        className="text-muted-foreground hover:text-[hsl(var(--warning))] transition-colors"
                        title={t("삭제", "删除")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function CapturedCard({ label, img, busy, onDelete }: { label: string; img: string | null; busy: boolean; onDelete?: () => void }) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-2 border-b bg-muted/30 text-xs font-semibold flex items-center justify-between">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
          {img && onDelete && (
            <button
              onClick={onDelete}
              className="text-[hsl(var(--warning))] hover:opacity-70 transition-opacity"
              title={label}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="aspect-video bg-muted/20 flex items-center justify-center">
        {img ? (
          <img src={img} alt={label} className="w-full h-full object-contain" />
        ) : (
          <div className="text-xs text-muted-foreground">대기 중 / 待拍摄</div>
        )}
      </div>
    </div>
  );
}

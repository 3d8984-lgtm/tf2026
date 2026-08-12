import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

/** 트윈코드 형태 일치 판정 임계값 (허용오차 보정 점수 기준) */
const TWIN_MATCH_MIN = 0.72;


interface FieldCheck {
  /** VISUAL_FIELDS의 key와 1:1 매칭되는 식별자 (라벨 문구 변경과 무관하게 안정적) */
  key?: string;
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
    getExpected: e => e.dm_expected ?? "", getDetected: r => r.dm_barcode ?? "" },
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

  // 주문 폴더에 업로드된 트윈코드 이미지(형태 비교 기준)
  const { data: twincodeImages } = useQuery({
    queryKey: ["card-photo-twincode", order?.externalOrderId],
    enabled: !!order?.externalOrderId,
    queryFn: async () => {
      const folder = order!.externalOrderId;
      const map: Record<string, string> = {};
      const list: string[] = [];
      const { data: files } = await supabase.storage.from("twincode-images").list(folder);
      if (files) {
        for (const f of files) {
          const url = supabase.storage.from("twincode-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
          const k = f.name.replace(/\.[^.]+$/, "");
          map[k] = url;
          map[k.toLowerCase()] = url;
          list.push(url);
        }
      }
      return { map, list };
    },
  });

  /** 형태 비교에 사용할 등록 트윈코드 이미지 URL */
  const expectedTwincodeUrl = useMemo(() => {
    if (!expected) return undefined;
    if (expected.twincode_url) return expected.twincode_url;
    const map = twincodeImages?.map ?? {};
    const keys = [expected.twincode, expected.design_qr, expected.card_serial, expected.dm_expected]
      .filter(Boolean) as string[];
    for (const k of keys) {
      if (map[k]) return map[k];
      if (map[k.toLowerCase()]) return map[k.toLowerCase()];
    }
    return twincodeImages?.list?.[selectedItemIdx] ?? twincodeImages?.list?.[0];
  }, [expected, twincodeImages, selectedItemIdx]);


  // ── Auto-match by DM barcode ──────────────────────────────────────────
  const [dmInput, setDmInput] = useState("");
  const handleDmLookup = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const nz = (v: any) => String(v ?? "").trim().toLowerCase();
    for (const o of orders) {
      const idx = o.items.findIndex(it => nz(it.dm_expected) === nz(code) || nz(it.card_barcode) === nz(code));
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
  const videoStageRef = useRef<HTMLDivElement>(null);
  const twinGuideRef = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");

  const startCamera = useCallback(async (id?: string) => {
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
      // 트윈코드 형태 비교 정확도를 위해 최대한 높은 해상도를 요청한다.
      const hiRes = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } };
      const s = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, ...hiRes } : { facingMode: "environment", ...hiRes },
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

  const captureDataUrl = (crop?: { x: number; y: number; w: number; h: number } | null): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const sx = crop ? Math.max(0, Math.round(crop.x * v.videoWidth)) : 0;
    const sy = crop ? Math.max(0, Math.round(crop.y * v.videoHeight)) : 0;
    const sw = crop ? Math.min(v.videoWidth - sx, Math.round(crop.w * v.videoWidth)) : v.videoWidth;
    const sh = crop ? Math.min(v.videoHeight - sy, Math.round(crop.h * v.videoHeight)) : v.videoHeight;
    if (sw < 8 || sh < 8) return null;
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL("image/jpeg", 0.95);
  };

  /** 저장/표시용 이미지를 좌회전 90도로 변환한다 (분석은 원본 좌표계를 그대로 사용). */
  const rotateLeft90 = (dataUrl: string): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalHeight;
          c.height = img.naturalWidth;
          const ctx = c.getContext("2d");
          if (!ctx) return resolve(dataUrl);
          ctx.translate(0, c.height);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL("image/jpeg", 0.95));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });




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
  /** 뒷면 사진에서 트윈코드 영역만 잘라낸 이미지 (형태 비교용) */
  const [twinCrop, setTwinCrop] = useState<string>("");
  /** 원본 트윈코드 vs 촬영 트윈코드 형태 유사도 (0~1) */
  const [twinScore, setTwinScore] = useState<number | null>(null);
  /** 작업자가 수동으로 트윈코드 일치를 확정했는지 여부 */
  const [twinManual, setTwinManual] = useState(false);
  /** 유사도 점수가 계산되지 않은 경우의 사유 */
  const [twinScoreNote, setTwinScoreNote] = useState("");
  /**
   * 영역(ROI) 설정은 백엔드 공용 테이블(inspection_roi_settings)에 저장한다.
   * → 브라우저/화면/PC가 바뀌어도 저장된 위치·크기가 동일하게 적용된다.
   * localStorage는 오프라인 캐시 용도로만 함께 유지한다.
   */
  type Roi = { x: number; y: number; w: number; h: number };
  const ROI_DB_KEY = (name: "card" | "twin" | "dm") => `card-photo-${name}-roi`;
  const isRoi = (p: any): p is Roi =>
    !!p && (["x", "y", "w", "h"] as const).every(k => typeof p[k] === "number");
  const pushRoiSetting = async (name: "card" | "twin" | "dm", value: Roi) => {
    try {
      const { error } = await supabase
        .from("inspection_roi_settings")
        .upsert({ setting_key: ROI_DB_KEY(name), setting_value: value }, { onConflict: "setting_key" });
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn("[roi] save to backend failed", e);
      return false;
    }
  };
  const clearRoiSetting = async (name: "card" | "twin" | "dm") => {
    try {
      await supabase.from("inspection_roi_settings").delete().eq("setting_key", ROI_DB_KEY(name));
    } catch (e) {
      console.warn("[roi] delete from backend failed", e);
    }
  };
  /**
   * 트윈코드 가이드 영역(촬영 화면 기준 비율).

   * 카드를 매번 같은 위치에 두면 이 영역에서 트윈코드를 자동 추출한다.
   */
  const [twinRoi, setTwinRoi] = useState<{ x: number; y: number; w: number; h: number }>(() => {
    try {
      const s = localStorage.getItem("card-photo-twin-roi-v2");
      if (s) return JSON.parse(s);
    } catch { /* ignore */ }
    return { x: 0.26, y: 0.24, w: 0.13, h: 0.22 };
  });
  /** 저장된 트윈코드 영역 (저장 시에만 갱신, 촬영 추출 기준으로 사용) */
  const [savedRoi, setSavedRoi] = useState<{ x: number; y: number; w: number; h: number } | null>(() => {
    try {
      const s = localStorage.getItem("card-photo-twin-roi-v2");
      if (s) return JSON.parse(s);
    } catch { /* ignore */ }
    return null;
  });
  const roiDirty = !savedRoi || (["x", "y", "w", "h"] as const).some(k => Math.abs(savedRoi[k] - twinRoi[k]) > 0.001);
  const saveTwinRoi = async () => {
    const normalizedRoi = {
      x: Math.max(0, Math.min(1, twinRoi.x)),
      y: Math.max(0, Math.min(1, twinRoi.y)),
      w: Math.max(0.02, Math.min(1 - twinRoi.x, twinRoi.w)),
      h: Math.max(0.02, Math.min(1 - twinRoi.y, twinRoi.h)),
    };
    try { localStorage.setItem("card-photo-twin-roi-v2", JSON.stringify(normalizedRoi)); } catch { /* ignore */ }
    setTwinRoi(normalizedRoi);
    setSavedRoi(normalizedRoi);
    const ok = await pushRoiSetting("twin", normalizedRoi);
    toast.success(ok
      ? t("트윈코드 영역이 저장되었습니다 (모든 PC 공통)", "TwinCode 区域已保存（所有电脑共用）")
      : t("트윈코드 영역이 이 PC에만 저장되었습니다", "TwinCode 区域仅保存在本机"));
  };
  const resetTwinRoi = async () => {
    const d = { x: 0.26, y: 0.24, w: 0.13, h: 0.22 };
    setTwinRoi(d);
    setSavedRoi(null);
    try { localStorage.removeItem("card-photo-twin-roi-v2"); } catch { /* ignore */ }
    await clearRoiSetting("twin");
    toast.info(t("트윈코드 영역이 초기화되었습니다", "TwinCode 区域已重置"));
  };


  /**
   * DM 바코드 가이드 영역 (실제 영상 영역 기준 비율).
   * v1 키는 레터박스를 고려하지 않은 "컨테이너 기준" 좌표였기 때문에,
   * 영상 영역(videoBox) 기준으로 바뀐 뒤에는 위치/크기가 어긋나 보였다.
   * → v2 키로 분리하고 옛 v1 값은 폐기한다.
   */
  const DM_ROI_KEY = "card-photo-dm-roi-v2";
  const DM_ROI_DEFAULT = { x: 0.6, y: 0.6, w: 0.14, h: 0.2 };
  const readDmRoi = () => {
    try {
      localStorage.removeItem("card-photo-dm-roi-v1");
      const s = localStorage.getItem(DM_ROI_KEY);
      if (s) {
        const p = JSON.parse(s);
        if (["x", "y", "w", "h"].every(k => typeof p?.[k] === "number")) return p as typeof DM_ROI_DEFAULT;
      }
    } catch { /* ignore */ }
    return null;
  };
  const [dmRoi, setDmRoi] = useState<{ x: number; y: number; w: number; h: number }>(() => readDmRoi() ?? DM_ROI_DEFAULT);
  const [savedDmRoi, setSavedDmRoi] = useState<{ x: number; y: number; w: number; h: number } | null>(() => readDmRoi());
  const dmRoiDirty = !savedDmRoi || (["x", "y", "w", "h"] as const).some(k => Math.abs(savedDmRoi[k] - dmRoi[k]) > 0.001);
  const saveDmRoi = async () => {
    const n = {
      x: Math.max(0, Math.min(1, dmRoi.x)),
      y: Math.max(0, Math.min(1, dmRoi.y)),
      w: Math.max(0.02, Math.min(1 - dmRoi.x, dmRoi.w)),
      h: Math.max(0.02, Math.min(1 - dmRoi.y, dmRoi.h)),
    };
    try { localStorage.setItem(DM_ROI_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    setDmRoi(n);
    setSavedDmRoi(n);
    const ok = await pushRoiSetting("dm", n);
    toast.success(ok
      ? t("DM 바코드 영역이 저장되었습니다 (모든 PC 공통)", "DM条码区域已保存（所有电脑共用）")
      : t("DM 바코드 영역이 이 PC에만 저장되었습니다", "DM条码区域仅保存在本机"));
  };
  const resetDmRoi = async () => {
    setDmRoi(DM_ROI_DEFAULT);
    setSavedDmRoi(null);
    try { localStorage.removeItem(DM_ROI_KEY); } catch { /* ignore */ }
    await clearRoiSetting("dm");
    toast.info(t("DM 바코드 영역이 초기화되었습니다", "DM条码区域已重置"));
  };


  /**
   * 카드 위치 영역 (실제 영상 영역 기준 비율).
   * 촬영 시 이 사각형 안쪽만 잘라서 저장/분석한다.
   */
  const CARD_ROI_KEY = "card-photo-card-roi-v1";
  const CARD_ROI_DEFAULT = { x: 0.2, y: 0.06, w: 0.6, h: 0.88 };
  const readCardRoi = () => {
    try {
      const s = localStorage.getItem(CARD_ROI_KEY);
      if (s) {
        const p = JSON.parse(s);
        if (["x", "y", "w", "h"].every(k => typeof p?.[k] === "number")) return p as typeof CARD_ROI_DEFAULT;
      }
    } catch { /* ignore */ }
    return null;
  };
  const [cardRoi, setCardRoi] = useState<{ x: number; y: number; w: number; h: number }>(() => readCardRoi() ?? CARD_ROI_DEFAULT);
  const [savedCardRoi, setSavedCardRoi] = useState<{ x: number; y: number; w: number; h: number } | null>(() => readCardRoi());
  const cardRoiDirty = !savedCardRoi || (["x", "y", "w", "h"] as const).some(k => Math.abs(savedCardRoi[k] - cardRoi[k]) > 0.001);
  const saveCardRoi = async () => {
    const n = {
      x: Math.max(0, Math.min(1, cardRoi.x)),
      y: Math.max(0, Math.min(1, cardRoi.y)),
      w: Math.max(0.05, Math.min(1 - cardRoi.x, cardRoi.w)),
      h: Math.max(0.05, Math.min(1 - cardRoi.y, cardRoi.h)),
    };
    try { localStorage.setItem(CARD_ROI_KEY, JSON.stringify(n)); } catch { /* ignore */ }
    setCardRoi(n);
    setSavedCardRoi(n);
    const ok = await pushRoiSetting("card", n);
    toast.success(ok
      ? t("카드 영역이 저장되었습니다 (모든 PC 공통)", "卡片区域已保存（所有电脑共用）")
      : t("카드 영역이 이 PC에만 저장되었습니다", "卡片区域仅保存在本机"));
  };
  const resetCardRoi = async () => {
    setCardRoi(CARD_ROI_DEFAULT);
    setSavedCardRoi(null);
    try { localStorage.removeItem(CARD_ROI_KEY); } catch { /* ignore */ }
    await clearRoiSetting("card");
    toast.info(t("카드 영역이 초기화되었습니다", "卡片区域已重置"));
  };

  /** 최초 진입 시 백엔드에 저장된 영역 설정을 불러와 적용한다 (다른 PC와 동일 적용). */
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("inspection_roi_settings")
        .select("setting_key, setting_value");
      if (!alive || error || !data) return;
      const apply = (
        name: "card" | "twin" | "dm",
        setRoi: (r: Roi) => void,
        setSaved: (r: Roi) => void,
        lsKey: string,
      ) => {
        const row = data.find(r => r.setting_key === ROI_DB_KEY(name));
        if (!row || !isRoi(row.setting_value)) return;
        const v = row.setting_value as Roi;
        setRoi(v);
        setSaved(v);
        try { localStorage.setItem(lsKey, JSON.stringify(v)); } catch { /* ignore */ }
      };
      apply("card", setCardRoi, setSavedCardRoi, CARD_ROI_KEY);
      apply("twin", setTwinRoi, setSavedRoi, "card-photo-twin-roi-v2");
      apply("dm", setDmRoi, setSavedDmRoi, DM_ROI_KEY);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 전체 프레임 기준 ROI를 "카드 영역만 잘라낸 이미지" 기준으로 변환한다. */
  const toCardSpace = (
    roi: { x: number; y: number; w: number; h: number },
    frame: { x: number; y: number; w: number; h: number } | null,
  ) => {
    if (!frame || frame.w <= 0 || frame.h <= 0) return roi;
    const x = (roi.x - frame.x) / frame.w;
    const y = (roi.y - frame.y) / frame.h;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      w: Math.max(0.01, Math.min(1 - Math.max(0, x), roi.w / frame.w)),
      h: Math.max(0.01, Math.min(1 - Math.max(0, y), roi.h / frame.h)),
    };
  };




  /** 실제 카메라 프레임의 종횡비 (object-contain 레터박스 계산용) */
  const [videoAr, setVideoAr] = useState(16 / 9);
  /** 컨테이너(16:9) 안에서 실제 영상이 차지하는 영역 (0~1 비율) */
  const videoBox = (() => {
    const box = 16 / 9;
    if (!videoAr || videoAr === box) return { left: 0, top: 0, width: 1, height: 1 };
    if (videoAr > box) {
      const h = box / videoAr;
      return { left: 0, top: (1 - h) / 2, width: 1, height: h };
    }
    const w = videoAr / box;
    return { left: (1 - w) / 2, top: 0, width: w, height: 1 };
  })();



  const normKey = (v: any) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const digits = (v: any) => String(v ?? "").replace(/\D/g, "");
  /** "EDITION 3/8", "#3", "03" → "3" (compare only the edition number itself). */
  const edNum = (v: any) => {
    const s = String(v ?? "").replace(/edition/gi, "").trim();
    const m = s.match(/\d+/);
    return m ? String(parseInt(m[0], 10)) : "";
  };

  /** 현재 주문의 랜덤 표본 대상 카드 index 목록 (아래에서 계산되어 ref로 주입) */
  const sampleIdxsRef = useRef<number[]>([]);

  /** Find a card whose CP score AND edition both match the detected front values. */
  const findByFront = useCallback((cp: string, ed: string) => {
    const cpD = digits(cp);
    const edN = edNum(ed);
    if (!cpD && !edN) return null;
    const pool = order ? [order] : orders;
    const allowed = sampleIdxsRef.current;
    // 1) CP + EDITION both match  2) EDITION only  3) CP only (single candidate)
    const matchers: ((it: CardItem) => boolean)[] = [
      it => !!cpD && !!edN && digits(it.cp_score) === cpD && edNum(it.edition) === edN,
      it => !!edN && edNum(it.edition) === edN,
      it => !!cpD && digits(it.cp_score) === cpD,
    ];
    for (const fn of matchers) {
      for (const o of pool) {
        let hits = o.items.map((it, i) => (fn(it) ? i : -1)).filter(i => i >= 0);
        // 표본 검사 계획이 있으면 계획에 포함된 카드만 후보로 인정한다.
        if (o.id === order?.id && allowed.length) {
          const inPlan = hits.filter(i => allowed.includes(i));
          if (hits.length && !inPlan.length) return { o, idx: hits[0], outOfPlan: true };
          hits = inPlan;
        }
        if (hits.length === 1) return { o, idx: hits[0], outOfPlan: false };
        // 여러 장이 같은 값이면 현재 선택된 카드가 후보에 있으면 그것을 사용
        if (hits.length > 1) {
          if (o.id === order?.id && hits.includes(selectedItemIdx)) return { o, idx: selectedItemIdx, outOfPlan: false };
          return { o, idx: hits[0], outOfPlan: false };
        }
      }
    }
    return null;
  }, [orders, order, selectedItemIdx]);



  /**
   * DM(Data Matrix) 바코드를 실제로 디코딩해 "값" 기준으로 판정한다.
   * 1) 지정한 DM 가이드 영역을 확대·대비강화·이진화하여 우선 시도
   * 2) 실패 시 원본 전체 → 타일 분할 확대 순으로 재시도
   */
  const decodeDataMatrix = async (
    dataUrl: string,
    roi?: { x: number; y: number; w: number; h: number } | null,
  ): Promise<string> => {
    try {
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");
      const hints = new Map<any, any>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints as any);

      const tryUrl = async (u: string) => {
        try {
          const r = await reader.decodeFromImageUrl(u);
          return r?.getText?.()?.trim() ?? "";
        } catch { return ""; }
      };

      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("load failed"));
        img.src = dataUrl;
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";

      /** 영역을 큰 배율로 그린 뒤 여러 전처리 변형(원본/이진화/반전/회전)으로 시도 */
      const tryRegion = async (sx: number, sy: number, sw: number, sh: number, target = 1400) => {
        if (sw < 8 || sh < 8) return "";
        const scale = Math.min(8, target / Math.max(sw, sh));
        const dw = Math.max(1, Math.round(sw * scale));
        const dh = Math.max(1, Math.round(sh * scale));
        // 여백(quiet zone) 확보를 위해 흰 테두리를 둔다
        const pad = Math.round(Math.max(dw, dh) * 0.08);
        canvas.width = dw + pad * 2;
        canvas.height = dh + pad * 2;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, pad, pad, dw, dh);

        const base = canvas.toDataURL("image/png");
        const hit0 = await tryUrl(base);
        if (hit0) return hit0;

        // Otsu 이진화 + 반전본
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = id.data;
        const hist = new Array(256).fill(0);
        const gray = new Uint8Array(px.length / 4);
        for (let i = 0, j = 0; i < px.length; i += 4, j++) {
          const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
          gray[j] = g; hist[g]++;
        }
        const total = gray.length;
        let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, best = 0, thr = 128;
        for (let i = 0; i < 256; i++) {
          wB += hist[i]; if (!wB) continue;
          const wF = total - wB; if (!wF) break;
          sumB += i * hist[i];
          const mB = sumB / wB, mF = (sum - sumB) / wF;
          const between = wB * wF * (mB - mF) * (mB - mF);
          if (between > best) { best = between; thr = i; }
        }
        for (const invert of [false, true]) {
          for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            let v = gray[j] > thr ? 255 : 0;
            if (invert) v = 255 - v;
            px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
          }
          ctx.putImageData(id, 0, 0);
          const hit = await tryUrl(canvas.toDataURL("image/png"));
          if (hit) return hit;
        }
        return "";
      };

      // 1) 지정된 DM 가이드 영역 (여유 마진 포함)
      if (roi) {
        for (const m of [0.15, 0.4]) {
          const sx = Math.max(0, (roi.x - roi.w * m) * img.width);
          const sy = Math.max(0, (roi.y - roi.h * m) * img.height);
          const sw = Math.min(img.width - sx, roi.w * (1 + m * 2) * img.width);
          const sh = Math.min(img.height - sy, roi.h * (1 + m * 2) * img.height);
          const hit = await tryRegion(sx, sy, sw, sh);
          if (hit) return hit;
        }
      }

      // 2) 원본 전체
      const direct = await tryUrl(dataUrl);
      if (direct) return direct;

      // 3) 타일 분할 확대 (25% 겹침)
      const cols = 3, rows = 3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const w = img.width / cols, h = img.height / rows;
          const sx = Math.max(0, c * w - w * 0.25);
          const sy = Math.max(0, r * h - h * 0.25);
          const hit = await tryRegion(sx, sy, Math.min(img.width - sx, w * 1.5), Math.min(img.height - sy, h * 1.5), 1200);
          if (hit) return hit;
        }
      }
      return "";
    } catch {
      return "";
    }
  };



  /** 외부(S3) 자산은 CORS로 직접 fetch가 막히므로 실패 시 백엔드 프록시로 받아온다. */
  const fetchAssetBlob = async (url: string): Promise<Blob> => {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return await res.blob();
    } catch {
      const { data, error } = await supabase.functions.invoke("download-file", {
        body: { url, filename: "asset" },
      });
      if (error) throw new Error(error.message || "proxy failed");
      if (data instanceof Blob) return data;
      if (data instanceof ArrayBuffer) return new Blob([data]);
      if (typeof data === "string") return new Blob([data], { type: "image/svg+xml" });
      throw new Error("proxy returned unexpected payload");
    }
  };

  const blobToDataUrl = (blob: Blob) => new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("read failed"));
    fr.readAsDataURL(blob);
  });

  // The AI model cannot read SVG URLs, so rasterize the registered TwinCode to PNG.
  const toRasterDataUrl = async (url: string): Promise<string | undefined> => {
    if (!url) return undefined;
    try {
      // 원문을 직접(또는 프록시로) 받아 data URL로 인라인해야 캔버스 오염 없이 픽셀을 읽을 수 있다.
      let src = url;
      if (!url.startsWith("data:")) {
        const blob = await fetchAssetBlob(url);
        const isSvg = (blob.type || "").includes("svg") || /\.svg($|\?)/i.test(url);
        if (isSvg) {
          const text = await blob.text();
          src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        } else {
          src = await blobToDataUrl(blob);
        }
      }
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("load failed"));
        img.src = src;
      });
      const size = 1024;
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) return undefined;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL("image/png");
    } catch (e) {
      console.warn("[toRasterDataUrl] failed", url, e);
      return undefined;
    }
  };



  const loadImage = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("load failed"));
    img.src = src;
  });

  /** 촬영 이미지에서 가이드 영역(트윈코드)만 잘라 확대하고 좌회전 90도 적용한다. */
  const cropRoi = async (dataUrl: string, roi: { x: number; y: number; w: number; h: number }) => {
    try {
      const img = await loadImage(dataUrl);
      const sx = Math.max(0, roi.x * img.width);
      const sy = Math.max(0, roi.y * img.height);
      const sw = Math.min(img.width - sx, roi.w * img.width);
      const sh = Math.min(img.height - sy, roi.h * img.height);
      if (sw <= 2 || sh <= 2) return "";
      // 저해상도 크롭은 형태 비교 정확도를 떨어뜨리므로 1024px 기준으로 업스케일한다.
      const scale = Math.min(6, 1024 / Math.max(sw, sh));
      const dw = Math.round(sw * scale);
      const dh = Math.round(sh * scale);
      const c = document.createElement("canvas");
      // 좌회전 90도 → 가로/세로가 서로 바뀐다
      c.width = dh;
      c.height = dw;
      const ctx = c.getContext("2d");
      if (!ctx) return "";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(0, c.height);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
      return c.toDataURL("image/png");
    } catch { return ""; }
  };

  /** 표시된 빨간 가이드의 실제 DOM 위치를 영상 프레임 비율로 변환한다. */
  const getDisplayedGuideRoi = () => {
    const stage = videoStageRef.current;
    const guide = twinGuideRef.current;
    if (!stage || !guide) return twinRoi;
    const stageRect = stage.getBoundingClientRect();
    const guideRect = guide.getBoundingClientRect();
    const frameLeft = stageRect.left + videoBox.left * stageRect.width;
    const frameTop = stageRect.top + videoBox.top * stageRect.height;
    const frameWidth = videoBox.width * stageRect.width;
    const frameHeight = videoBox.height * stageRect.height;
    if (frameWidth <= 0 || frameHeight <= 0) return twinRoi;
    return {
      x: Math.max(0, Math.min(1, (guideRect.left - frameLeft) / frameWidth)),
      y: Math.max(0, Math.min(1, (guideRect.top - frameTop) / frameHeight)),
      w: Math.max(0, Math.min(1, guideRect.width / frameWidth)),
      h: Math.max(0, Math.min(1, guideRect.height / frameHeight)),
    };
  };

  /**
   * 이미지를 N×N 이진 마스크(잉크=1)로 변환. 여백은 잘라내 정규화한다.
   * 촬영본은 조명/그림자 영향이 크므로 Otsu 자동 임계값 + 박스 평균 다운샘플을 사용한다.
   */
  const toMask = async (src: string, N = 96): Promise<Uint8Array | null> => {
    try {
      const img = await loadImage(src);
      const c = document.createElement("canvas");
      const w = 512, h = 512;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const gray = new Float32Array(w * h);
      const hist = new Float64Array(256);
      for (let i = 0; i < w * h; i++) {
        const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        gray[i] = g;
        hist[Math.min(255, Math.max(0, Math.round(g)))]++;
      }
      // Otsu 임계값
      const total = w * h;
      let sumAll = 0;
      for (let i = 0; i < 256; i++) sumAll += i * hist[i];
      let sumB = 0, wB = 0, best = -1, thr = 128;
      for (let i = 0; i < 256; i++) {
        wB += hist[i];
        if (!wB) continue;
        const wF = total - wB;
        if (!wF) break;
        sumB += i * hist[i];
        const mB = sumB / wB, mF = (sumAll - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; thr = i; }
      }
      // bounding box of ink
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      const bin = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (gray[y * w + x] < thr) {
          bin[y * w + x] = 1;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const out = new Uint8Array(N * N);
      // 셀 단위 평균(50% 이상 잉크면 1) → 노이즈에 강하다
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const xa = x0 + Math.floor((x / N) * bw);
        const xb = Math.max(xa + 1, x0 + Math.floor(((x + 1) / N) * bw));
        const ya = y0 + Math.floor((y / N) * bh);
        const yb = Math.max(ya + 1, y0 + Math.floor(((y + 1) / N) * bh));
        let ink = 0, cnt = 0;
        for (let yy = ya; yy < yb && yy < h; yy++) for (let xx = xa; xx < xb && xx < w; xx++) {
          ink += bin[yy * w + xx]; cnt++;
        }
        out[y * N + x] = cnt && ink / cnt >= 0.5 ? 1 : 0;
      }
      return out;
    } catch { return null; }
  };


  const rotateMask = (m: Uint8Array, N: number) => {
    const r = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) r[x * N + (N - 1 - y)] = m[y * N + x];
    return r;
  };

  const iou = (a: Uint8Array, b: Uint8Array) => {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] || b[i]) uni++;
      if (a[i] && b[i]) inter++;
    }
    return uni ? inter / uni : 0;
  };

  /** 1픽셀 팽창(dilation) — 인쇄/촬영 오차에 대한 허용치를 준다. */
  const dilate = (m: Uint8Array, N: number, r = 1) => {
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!m[y * N + x]) continue;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const ny = y + dy, nx = x + dx;
        if (ny >= 0 && ny < N && nx >= 0 && nx < N) o[ny * N + nx] = 1;
      }
    }
    return o;
  };

  const shift = (m: Uint8Array, N: number, dx: number, dy: number) => {
    if (!dx && !dy) return m;
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sy = y - dy, sx = x - dx;
      if (sy >= 0 && sy < N && sx >= 0 && sx < N) o[y * N + x] = m[sy * N + sx];
    }
    return o;
  };

  /**
   * 허용 오차를 반영한 형태 유사도.
   * 촬영본은 미세한 위치·굵기·해상도 차이가 있으므로
   * 팽창(dilation) 마스크 기준의 양방향 커버리지로 비교한다.
   */
  const tolerantScore = (a: Uint8Array, b: Uint8Array, N: number) => {
    const ad = dilate(a, N), bd = dilate(b, N);
    let aIn = 0, aTot = 0, bIn = 0, bTot = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i]) { aTot++; if (bd[i]) aIn++; }
      if (b[i]) { bTot++; if (ad[i]) bIn++; }
    }
    if (!aTot || !bTot) return 0;
    const ca = aIn / aTot, cb = bIn / bTot;
    return (2 * ca * cb) / (ca + cb); // 조화평균
  };

  // ── 형태(Shape) 기반 기술자 ────────────────────────────────────────────
  /**
   * Hu 불변 모멘트 (이동·크기·회전 불변).
   * 픽셀 위치가 아니라 "형태의 분포 구조"를 수치화한다.
   */
  const huMoments = (m: Uint8Array, N: number): number[] | null => {
    let m00 = 0, m10 = 0, m01 = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!m[y * N + x]) continue;
      m00++; m10 += x; m01 += y;
    }
    if (m00 < 5) return null;
    const cx = m10 / m00, cy = m01 / m00;
    const mu: Record<string, number> = { "20": 0, "02": 0, "11": 0, "30": 0, "03": 0, "21": 0, "12": 0 };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!m[y * N + x]) continue;
      const dx = x - cx, dy = y - cy;
      mu["20"] += dx * dx; mu["02"] += dy * dy; mu["11"] += dx * dy;
      mu["30"] += dx * dx * dx; mu["03"] += dy * dy * dy;
      mu["21"] += dx * dx * dy; mu["12"] += dx * dy * dy;
    }
    const n = (p: number, q: number, v: number) => v / Math.pow(m00, 1 + (p + q) / 2);
    const n20 = n(2, 0, mu["20"]), n02 = n(0, 2, mu["02"]), n11 = n(1, 1, mu["11"]);
    const n30 = n(3, 0, mu["30"]), n03 = n(0, 3, mu["03"]), n21 = n(2, 1, mu["21"]), n12 = n(1, 2, mu["12"]);
    const h1 = n20 + n02;
    const h2 = (n20 - n02) ** 2 + 4 * n11 ** 2;
    const h3 = (n30 - 3 * n12) ** 2 + (3 * n21 - n03) ** 2;
    const h4 = (n30 + n12) ** 2 + (n21 + n03) ** 2;
    const h5 = (n30 - 3 * n12) * (n30 + n12) * ((n30 + n12) ** 2 - 3 * (n21 + n03) ** 2)
      + (3 * n21 - n03) * (n21 + n03) * (3 * (n30 + n12) ** 2 - (n21 + n03) ** 2);
    const h6 = (n20 - n02) * ((n30 + n12) ** 2 - (n21 + n03) ** 2) + 4 * n11 * (n30 + n12) * (n21 + n03);
    const h7 = (3 * n21 - n03) * (n30 + n12) * ((n30 + n12) ** 2 - 3 * (n21 + n03) ** 2)
      - (n30 - 3 * n12) * (n21 + n03) * (3 * (n30 + n12) ** 2 - (n21 + n03) ** 2);
    // log 스케일로 압축 (부호 유지)
    return [h1, h2, h3, h4, h5, h6, h7].map((v) => Math.sign(v) * Math.log10(1 + Math.abs(v) * 1e6));
  };

  /** 무게중심 기준 극좌표 형태 시그니처 (각도별 평균 반경). 회전은 순환 정렬로 흡수한다. */
  const polarSignature = (m: Uint8Array, N: number, bins = 72): number[] | null => {
    let cnt = 0, sx = 0, sy = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) { cnt++; sx += x; sy += y; }
    if (cnt < 5) return null;
    const cx = sx / cnt, cy = sy / cnt;
    const sum = new Float64Array(bins), num = new Float64Array(bins);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!m[y * N + x]) continue;
      const dx = x - cx, dy = y - cy;
      const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const b = Math.min(bins - 1, Math.floor((ang / (Math.PI * 2)) * bins));
      sum[b] += Math.hypot(dx, dy); num[b]++;
    }
    const sig = Array.from({ length: bins }, (_, i) => (num[i] ? sum[i] / num[i] : 0));
    const max = Math.max(...sig);
    return max > 0 ? sig.map((v) => v / max) : null; // 크기 정규화
  };

  /** 두 시그니처의 순환 상관 유사도(회전 불변). */
  const signatureSimilarity = (a: number[], b: number[]) => {
    const n = a.length;
    let best = 0;
    for (let s = 0; s < n; s++) {
      let diff = 0;
      for (let i = 0; i < n; i++) diff += Math.abs(a[i] - b[(i + s) % n]);
      const sim = 1 - diff / n;
      if (sim > best) best = sim;
    }
    return Math.max(0, best);
  };

  /** Hu 모멘트 거리 → 0~1 유사도 */
  const huSimilarity = (a: number[], b: number[]) => {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return Math.max(0, 1 - d / 12);
  };

  /**
   * 원본 트윈코드와 촬영 크롭의 **형태 유사도**(0~1).
   * 픽셀 겹침이 아니라 형태 기술자(Hu 불변 모멘트 + 극좌표 형태 시그니처)를 주 지표로 사용하고,
   * 구조적 배치 확인용으로 정합 후 커버리지를 보조 지표로 가중 합산한다.
   */
  const compareTwinShape = async (refSrc: string, cropSrc: string): Promise<number | null> => {
    const N = 96;
    const [a, b0] = await Promise.all([toMask(refSrc, N), toMask(cropSrc, N)]);
    if (!a || !b0) return null;

    // 1) 형태 기술자 (이동·크기·회전 불변) — 주 지표
    const huA = huMoments(a, N), sigA = polarSignature(a, N);
    const huB = huMoments(b0, N), sigB = polarSignature(b0, N);
    const huS = huA && huB ? huSimilarity(huA, huB) : 0;
    const sigS = sigA && sigB ? signatureSimilarity(sigA, sigB) : 0;
    const descriptor = huA && huB && sigA && sigB ? 0.45 * huS + 0.55 * sigS : Math.max(huS, sigS);

    // 2) 구조 정합 (회전 4방향 + 미세 이동 보정) — 보조 지표
    let overlap = 0, b = b0;
    for (let i = 0; i < 4; i++) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const bs = shift(b, N, dx, dy);
        const s = tolerantScore(a, bs, N);
        if (s > overlap) overlap = s;
      }
      b = rotateMask(b, N);
    }

    // 형태 기술자 중심(70%) + 구조 정합(30%)
    return Math.min(1, 0.7 * descriptor + 0.3 * overlap);
  };



  const inspectImage = async (
    side: "front" | "back",
    dataUrl: string,
    frame?: { x: number; y: number; w: number; h: number } | null,
  ) => {
    setBusySide(side);
    try {
      const referenceTwincode = side === "back" ? await toRasterDataUrl(expectedTwincodeUrl || "") : undefined;

      if (side === "back") {
        // 저장 후 슬라이더가 다시 움직였더라도 실제 검사는 마지막으로 확정 저장한 영역만 사용한다.
        // 사진은 카드 영역만 잘려 있으므로 ROI 좌표도 카드 영역 기준으로 변환한다.
        const crop = await cropRoi(dataUrl, toCardSpace(savedRoi ?? getDisplayedGuideRoi(), frame ?? null));

        setTwinCrop(crop);
        if (!expectedTwincodeUrl) {
          setTwinScore(null);
          setTwinScoreNote(t("주문에 등록된 원본 트윈코드가 없습니다", "订单未登记原始TwinCode"));
        } else if (!referenceTwincode) {
          setTwinScore(null);
          setTwinScoreNote(t("원본 트윈코드 이미지를 불러오지 못했습니다", "无法加载原始TwinCode图像"));
        } else if (!crop) {
          setTwinScore(null);
          setTwinScoreNote(t("가이드 영역 추출에 실패했습니다", "引导区域提取失败"));
        } else {
          const s = await compareTwinShape(referenceTwincode, crop);
          setTwinScore(s);
          setTwinScoreNote(s === null ? t("이미지에서 형태를 인식하지 못했습니다 (초점/대비 확인)", "无法识别形状（请检查对焦/对比度）") : "");
        }
      }


      const [{ data, error }, decodedDm] = await Promise.all([
        supabase.functions.invoke("card-photo-inspect", {
          body: { side, image: dataUrl, reference_twincode: referenceTwincode },
        }),
        side === "back" ? decodeDataMatrix(dataUrl, toCardSpace(savedDmRoi ?? dmRoi, frame ?? null)) : Promise.resolve(""),
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
        if (hit && hit.outOfPlan) {
          setFrontMatch("failed");
          toast.error(t(
            `표본 대상이 아닌 카드입니다 (#${hit.idx + 1}). 검사 대상: ${sampleIdxsRef.current.map(i => `#${i + 1}`).join(", ")}`,
            `该卡片不在抽检样本内 (#${hit.idx + 1})。抽检对象: ${sampleIdxsRef.current.map(i => `#${i + 1}`).join(", ")}`));
        } else if (hit) {
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
        const dm = String(ex.dm_barcode ?? "").trim().toLowerCase();
        if (dm && !selectedOrderId) {
          for (const o of orders) {
            const idx = o.items.findIndex(it =>
              String(it.dm_expected ?? "").trim().toLowerCase() === dm ||
              String(it.card_barcode ?? "").trim().toLowerCase() === dm);

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
    // 카드 영역(노란 사각형) 안쪽만 잘라서 저장·분석한다.
    const frame = savedCardRoi ?? cardRoi;
    const url = captureDataUrl(frame);
    if (!url) {
      toast.error(t("카메라가 준비되지 않았습니다", "摄像头未准备好"));
      return;
    }
    // 저장·표시용은 좌회전 90도(세로) 이미지로 통일한다.
    const shown = await rotateLeft90(url);
    if (side === "front") {
      // 앞면 촬영 = 새 카드 검사 시작 → 이전 카드의 뒷면 결과가 남지 않도록 모두 초기화한다.
      setFrontImg(shown); setFrontResult(null); setFrontMatch("idle");
      setBackImg(null); setBackResult(null); setDmDecoded("");
      setTwinCrop(""); setTwinScore(null); setTwinScoreNote(""); setTwinManual(false);
    } else {
      setBackImg(shown); setBackResult(null); setDmDecoded(""); setTwinCrop(""); setTwinScore(null); setTwinScoreNote(""); setTwinManual(false);
    }


    await inspectImage(side, url, frame);

  };

  const reset = () => {
    setFrontImg(null); setBackImg(null);
    setFrontResult(null); setBackResult(null);
    setFrontMatch("idle"); setDmDecoded("");
    setTwinCrop(""); setTwinScore(null); setTwinScoreNote(""); setTwinManual(false);
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
        key: "cp",
        label: t("CP 점수", "CP分数"),
        expected: String(expected.cp_score ?? ""),
        detected: frontResult.cp_score ?? "",
        match: norm(expected.cp_score).replace(/\D/g, "") === norm(frontResult.cp_score).replace(/\D/g, "")
          && !!norm(expected.cp_score),
      });
      list.push({
        key: "edition",
        label: "EDITION",
        expected: String(expected.edition ?? ""),
        detected: frontResult.edition ?? "",
        match: !!edNum(expected.edition) && edNum(expected.edition) === edNum(frontResult.edition),
      });
    }
    if (backResult) {
      list.push({
        key: "issued",
        label: "ISSUED No.",
        expected: expected.card_serial ?? "",
        detected: backResult.issued_no ?? "",
        match: !!expected.card_serial && norm(backResult.issued_no).includes(norm(expected.card_serial)),
      });
      list.push({
        key: "minted",
        label: "Minted on",
        expected: String(expected.minted_on ?? ""),
        detected: backResult.minted_on ?? "",
        match: norm(expected.minted_on) === norm(backResult.minted_on) && !!norm(expected.minted_on),
      });
      list.push({
        key: "grade",
        label: t("카드 등급", "卡片等级"),
        expected: expected.card_grade ?? "",
        detected: backResult.card_grade ?? "",
        match: !!gradeNorm(expected.card_grade) && gradeNorm(expected.card_grade) === gradeNorm(backResult.card_grade),
      });
      {
        // 1순위: 가이드 영역 크롭 vs 등록 SVG의 로컬 형태 유사도, 2순위: AI 판정
        const aiShape = backResult.twincode_shape_match === true;
        const hasLocal = twinScore !== null;
        const localOk = hasLocal && (twinScore as number) >= TWIN_MATCH_MIN;
        const shape = twinManual ? true : (hasLocal ? localOk : aiShape);
        list.push({
          key: "twin",
          label: t("트윈코드 (형태 비교)", "TwinCode (形状比对)"),
          expected: expectedTwincodeUrl
            ? t("등록된 트윈코드 형태", "已登记TwinCode形状")
            : t("등록 이미지 없음", "无已登记图像"),
          detected: twinManual
            ? `${t("수동 확정 일치", "人工确认一致")}${hasLocal ? ` (${Math.round((twinScore as number) * 100)}%)` : ""}`
            : !expectedTwincodeUrl
            ? t("비교 불가", "无法比对")
            : hasLocal
              ? `${shape ? t("형태 일치", "形状一致") : t("형태 불일치", "形状不一致")} (${Math.round((twinScore as number) * 100)}%)`
              : (shape ? t("형태 일치", "形状一致") : t("형태 불일치", "形状不一致")),
          match: twinManual || (!!expectedTwincodeUrl && shape),
        });
      }

      {
        // 기준값은 개별 주문번호 + "-4"
        const expDm = norm(expected.dm_expected);
        const gotDm = norm(dmDecoded || backResult.dm_barcode);
        list.push({
          key: "dm",
          label: t("DM 바코드 (값 비교)", "DM条码 (值比对)"),
          expected: expected.dm_expected ?? "",
          detected: dmDecoded || backResult.dm_barcode || t("디코딩 실패", "解码失败"),
          match: !!expDm && !!gotDm && expDm === gotDm,
        });
      }


    }
    return list;
  }, [expected, frontResult, backResult, dmDecoded, expectedTwincodeUrl, twinScore, twinManual, isKo]);

  const failCount = checks.filter(c => !c.match).length;
  const allDone = !!frontResult && !!backResult;

  // ── Inspection history (persisted in localStorage) ────────────────────
  type HistoryField = { label: string; expected: string; detected: string; match: boolean };
  type HistoryEntry = {
    key: string;             // `${orderId}::${itemIdx}`
    orderId: string;
    externalOrderId: string;
    itemIdx: number;
    cardSerial: string;
    dmBarcode: string;
    pass: boolean;
    failCount: number;
    fields?: HistoryField[];
    /** 촬영 사진(용량 절감을 위해 축소 저장) */
    frontPhoto?: string;
    backPhoto?: string;
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
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {
      // 용량 초과 시 사진을 제외하고 다시 저장
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(
          history.map(({ frontPhoto, backPhoto, ...rest }) => rest)
        ));
      } catch { /* ignore */ }
    }
  }, [history]);

  /** 기록 보관용 축소 이미지(JPEG) 생성 */
  const shrinkPhoto = useCallback((src: string | null, max = 900): Promise<string | undefined> => {
    if (!src) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.7));
        } catch { resolve(undefined); }
      };
      img.onerror = () => resolve(undefined);
      img.src = src;
    });
  }, []);

  /** 크게 보기용 뷰어 */
  const [photoViewer, setPhotoViewer] = useState<HistoryEntry | null>(null);

  const recordedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!allDone || !order || !expected) return;
    const key = `${order.id}::${selectedItemIdx}`;
    if (recordedRef.current.has(key)) return;
    recordedRef.current.add(key);
    let cancelled = false;
    (async () => {
      const [fp, bp] = await Promise.all([shrinkPhoto(frontImg), shrinkPhoto(backImg)]);
      if (cancelled) return;
      const entry: HistoryEntry = {
        key,
        orderId: order.id,
        externalOrderId: order.externalOrderId,
        itemIdx: selectedItemIdx,
        cardSerial: expected.card_serial ?? "",
        dmBarcode: expected.dm_expected ?? "",
        pass: failCount === 0,
        failCount,
        fields: checks.map(c => ({ label: c.label, expected: c.expected, detected: c.detected, match: c.match })),
        frontPhoto: fp,
        backPhoto: bp,
        at: Date.now(),
      };
      setHistory(prev => [entry, ...prev.filter(h => h.key !== key)]);
    })();
    return () => { cancelled = true; };
  }, [allDone, order, expected, selectedItemIdx, failCount, checks, frontImg, backImg, shrinkPhoto]);



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
  // 앞면 매칭 시 "표본 대상 카드"만 인정하도록 ref로 주입
  sampleIdxsRef.current = sampleIdxs;

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

  /** 이 주문건에 기록된 모든 검사 데이터(기록·표본계획·현재 촬영)를 초기화한다. */
  const resetOrderData = () => {
    if (!order) return;
    const ok = window.confirm(
      t(
        "이 주문건에 기록된 모든 검사 데이터(검사 기록, 표본 계획, 현재 촬영)를 삭제합니다. 계속할까요?",
        "将删除该订单的所有检验数据（检验记录、抽样计划、当前拍摄）。是否继续？"
      )
    );
    if (!ok) return;

    // 검사 기록 삭제
    setHistory(prev => prev.filter(h => h.orderId !== order.id));
    for (const k of Array.from(recordedRef.current)) {
      if (k.startsWith(`${order.id}::`)) recordedRef.current.delete(k);
    }

    // 표본 계획 재추첨
    const p = buildPlan(order.items.length);
    setPlans(prev => ({ ...prev, [order.id]: p }));
    setSelectedItemIdx(p[0] ?? 0);

    // 현재 촬영/판정 상태 초기화
    reset();
    toast.success(t("주문 검사 데이터를 초기화했습니다", "已重置该订单的检验数据"));
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
        <Button variant="outline" size="sm" onClick={resetOrderData}>
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
          <div className="flex flex-col md:flex-row gap-3">
            <div ref={videoStageRef} className="relative flex-1 aspect-video bg-black rounded overflow-hidden flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
                onLoadedMetadata={e => {
                  const v = e.currentTarget;
                  if (v.videoWidth && v.videoHeight) setVideoAr(v.videoWidth / v.videoHeight);
                }}
              />
              {/* 카드 위치 영역 — 촬영 시 이 안쪽만 저장된다 */}
              <div
                className="absolute border-2 border-dashed border-[hsl(var(--warning,45_100%_51%))] pointer-events-none"
                style={{
                  left: `${(videoBox.left + cardRoi.x * videoBox.width) * 100}%`,
                  top: `${(videoBox.top + cardRoi.y * videoBox.height) * 100}%`,
                  width: `${cardRoi.w * videoBox.width * 100}%`,
                  height: `${cardRoi.h * videoBox.height * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 text-[10px] font-semibold bg-background/80 px-1 rounded">
                  {t("카드 영역", "卡片区域")}
                </span>
              </div>
              {/* 트윈코드 가이드 영역 — 실제 영상 표시 영역(레터박스 제외) 기준으로 그린다 */}

              <div
                ref={twinGuideRef}
                className="absolute border-2 border-destructive pointer-events-none"
                style={{
                  left: `${(videoBox.left + twinRoi.x * videoBox.width) * 100}%`,
                  top: `${(videoBox.top + twinRoi.y * videoBox.height) * 100}%`,
                  width: `${twinRoi.w * videoBox.width * 100}%`,
                  height: `${twinRoi.h * videoBox.height * 100}%`,
                  boxShadow: "0 0 0 9999px hsl(var(--background) / 0.25)",
                }}
              >
                <span className="absolute -top-5 left-0 text-[10px] font-semibold text-destructive bg-background/80 px-1 rounded">
                  {t("트윈코드 영역", "TwinCode 区域")}
                </span>
              </div>
              {/* DM 바코드 가이드 영역 */}
              <div
                className="absolute border-2 border-primary pointer-events-none"
                style={{
                  left: `${(videoBox.left + dmRoi.x * videoBox.width) * 100}%`,
                  top: `${(videoBox.top + dmRoi.y * videoBox.height) * 100}%`,
                  width: `${dmRoi.w * videoBox.width * 100}%`,
                  height: `${dmRoi.h * videoBox.height * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 text-[10px] font-semibold text-primary bg-background/80 px-1 rounded">
                  {t("DM 바코드 영역", "DM条码区域")}
                </span>
              </div>

            </div>

            {/* 촬영 버튼 — 카메라 화면 오른쪽 */}
            <div className="flex md:flex-col gap-3 md:w-56 shrink-0">
              <Button className="flex-1 md:flex-none md:h-24" onClick={() => captureSide("front")} disabled={!stream || busySide !== null}>
                {busySide === "front" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {t("① 앞면 촬영 & 분석", "① 拍摄并分析正面")}
              </Button>
              <Button className="flex-1 md:flex-none md:h-24" onClick={() => captureSide("back")} disabled={!stream || busySide !== null} variant="secondary">
                {busySide === "back" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                {t("② 뒷면 촬영 & 분석", "② 拍摄并分析背面")}
              </Button>
            </div>
          </div>


          {/* 카드 영역 조정 */}
          <div className="mt-2 grid grid-cols-4 gap-2">
            {([
              ["x", t("좌", "左")], ["y", t("상", "上")], ["w", t("폭", "宽")], ["h", t("높이", "高")],
            ] as const).map(([k, label]) => (
              <label key={`card-${k}`} className="text-[10px] text-muted-foreground">
                {t("카드", "卡片")} {label}
                <input
                  type="range" min={1} max={100} step={0.5}
                  value={(cardRoi as any)[k] * 100}
                  onChange={e => setCardRoi(r => ({ ...r, [k]: Number(e.target.value) / 100 }))}
                  className="w-full"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant={cardRoiDirty ? "default" : "outline"} onClick={saveCardRoi}>
              {t("카드 영역 저장", "保存卡片区域")}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetCardRoi}>
              {t("초기화", "重置")}
            </Button>
            <span className="text-[10px] text-muted-foreground">
              {cardRoiDirty
                ? t("변경사항이 저장되지 않았습니다", "更改尚未保存")
                : t("저장됨 · 촬영 시 이 영역 안쪽만 이미지로 저장됩니다", "已保存 · 拍摄时仅保存该区域内的图像")}
            </span>
          </div>

          {/* 가이드 영역 조정 */}

          <div className="mt-2 grid grid-cols-4 gap-2">
            {([
              ["x", t("좌", "左")], ["y", t("상", "上")], ["w", t("폭", "宽")], ["h", t("높이", "高")],
            ] as const).map(([k, label]) => (
              <label key={k} className="text-[10px] text-muted-foreground">
                {label} <span className="tabular-nums">{((twinRoi as any)[k] * 100).toFixed(1)}%</span>
                <input
                  type="range" min={0.5} max={99.5} step={0.1}
                  value={(twinRoi as any)[k] * 100}
                  onChange={e => setTwinRoi(r => ({ ...r, [k]: Number(e.target.value) / 100 }))}
                  className="w-full accent-[hsl(var(--destructive))]"
                />
                <div className="flex gap-1 mt-0.5">
                  <button type="button" className="flex-1 rounded border px-1 py-0.5 hover:bg-muted"
                    onClick={() => setTwinRoi(r => ({ ...r, [k]: Math.max(0.005, Number((((r as any)[k] * 100 - 0.1) / 100).toFixed(5))) }))}>-</button>
                  <button type="button" className="flex-1 rounded border px-1 py-0.5 hover:bg-muted"
                    onClick={() => setTwinRoi(r => ({ ...r, [k]: Math.min(0.995, Number((((r as any)[k] * 100 + 0.1) / 100).toFixed(5))) }))}>+</button>
                </div>
              </label>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant={roiDirty ? "default" : "outline"} onClick={saveTwinRoi}>
              {t("트윈코드 영역 저장", "保存 TwinCode 区域")}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetTwinRoi}>
              {t("초기화", "重置")}
            </Button>
            <span className="text-[10px] text-muted-foreground">
              {roiDirty
                ? t("변경사항이 저장되지 않았습니다", "更改尚未保存")
                : t("저장됨 · 다음 촬영에도 같은 위치가 적용됩니다", "已保存 · 下次拍摄沿用相同位置")}
            </span>
          </div>

          {/* DM 바코드 영역 조정 */}
          <div className="mt-3 grid grid-cols-4 gap-2">
            {([
              ["x", t("좌", "左")], ["y", t("상", "上")], ["w", t("폭", "宽")], ["h", t("높이", "高")],
            ] as const).map(([k, label]) => (
              <label key={`dm-${k}`} className="text-[10px] text-muted-foreground">
                DM {label}
                <input
                  type="range" min={2} max={98} step={1}
                  value={Math.round((dmRoi as any)[k] * 100)}
                  onChange={e => setDmRoi(r => ({ ...r, [k]: Number(e.target.value) / 100 }))}
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </label>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button size="sm" variant={dmRoiDirty ? "default" : "outline"} onClick={saveDmRoi}>
              {t("DM 바코드 영역 저장", "保存 DM条码区域")}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetDmRoi}>
              {t("초기화", "重置")}
            </Button>
            <span className="text-[10px] text-muted-foreground">
              {dmRoiDirty
                ? t("변경사항이 저장되지 않았습니다", "更改尚未保存")
                : t("저장됨 · 이 영역만 확대·이진화하여 DM 값을 디코딩합니다", "已保存 · 仅放大二值化该区域解码DM值")}
            </span>
          </div>


          <div className="text-xs text-muted-foreground mt-3 mb-2">
            {t("① 앞면을 먼저 촬영하면 CP 점수와 EDITION으로 주문 카드가 자동 매칭됩니다. ② 그 다음 카드의 트윈코드가 빨간 사각형 안에 오도록 놓고 뒷면을 촬영하세요.", "① 先拍摄正面，通过CP分数与EDITION自动匹配订单卡片。② 然后将TwinCode对准红色方框拍摄背面。")}
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

        {/* TwinCode 형태 비교 — 원본(SVG) vs 촬영 크롭 */}
        {frontMatch === "matched" && (expectedTwincodeUrl || twinCrop) && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center justify-between gap-2">
              <span>{t("트윈코드 형태 비교", "TwinCode 形状比对")}</span>
              {twinManual ? (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]">
                  {t("수동 확정 일치", "人工确认一致")}{twinScore !== null ? ` · ${Math.round(twinScore * 100)}%` : ""}
                </span>
              ) : twinScore !== null && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  twinScore >= TWIN_MATCH_MIN
                    ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
                    : "bg-destructive/10 text-destructive"
                }`}>
                  {twinScore >= TWIN_MATCH_MIN ? t("형태 일치", "形状一致") : t("형태 불일치", "形状不一致")} · {Math.round(twinScore * 100)}%
                </span>
              )}

            </div>
            <div className="grid grid-cols-2 gap-4 p-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t("원본 (주문데이터 트윈코드 SVG)", "原始 (订单TwinCode SVG)")}</div>
                <div className="aspect-square rounded border bg-background flex items-center justify-center overflow-hidden">
                  {expectedTwincodeUrl
                    ? <img src={expectedTwincodeUrl} alt={t("원본 트윈코드", "原始TwinCode")} className="w-full h-full object-contain" />
                    : <span className="text-xs text-muted-foreground">{t("등록 이미지 없음", "无已登记图像")}</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t("촬영 추출 (가이드 영역)", "拍摄提取 (引导区域)")}</div>
                <div className={`aspect-square rounded border flex items-center justify-center overflow-hidden ${
                  twinScore === null ? "bg-muted/20" : twinScore >= TWIN_MATCH_MIN ? "border-[hsl(var(--success)/0.5)]" : "border-destructive/50"}`}>
                  {twinCrop
                    ? <img src={twinCrop} alt={t("촬영 트윈코드", "拍摄TwinCode")} className="w-full h-full object-contain" />
                    : <span className="text-xs text-muted-foreground">{t("뒷면 촬영 후 표시됩니다", "拍摄背面后显示")}</span>}
                </div>
              </div>
            </div>
            <div className="px-4 pb-3 flex flex-wrap items-center gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">{t("형태 유사도 점수", "形状相似度")}</span>
                <span className={`text-2xl font-bold tabular-nums ${
                  twinScore === null
                    ? "text-muted-foreground"
                    : twinScore >= TWIN_MATCH_MIN
                      ? "text-[hsl(var(--success))]"
                      : "text-destructive"
                }`}>
                  {twinScore === null ? "--" : `${(twinScore * 100).toFixed(1)}%`}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t(`기준 ${Math.round(TWIN_MATCH_MIN * 100)}% 이상`, `标准 ${Math.round(TWIN_MATCH_MIN * 100)}% 以上`)}
                </span>
                {twinScore === null && twinScoreNote && (
                  <span className="text-[11px] text-destructive">· {twinScoreNote}</span>
                )}

              </div>
              <div className="ml-auto flex items-center gap-2">
                {twinManual ? (
                  <Button size="sm" variant="outline" onClick={() => { setTwinManual(false); toast.info(t("수동 확정이 해제되었습니다", "已取消人工确认")); }}>
                    {t("수동 확정 해제", "取消人工确认")}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => { setTwinManual(true); toast.success(t("트윈코드를 수동으로 일치 확정했습니다", "已人工确认TwinCode一致")); }}>
                    {t("수동으로 일치 확정", "人工确认一致")}
                  </Button>
                )}
              </div>
            </div>
            <div className="px-4 pb-3 text-[11px] text-muted-foreground">
              {t("카드는 매번 같은 위치에 놓아야 합니다. 카메라 화면의 빨간 사각형에 트윈코드를 맞춘 뒤 촬영하세요. 사각형 위치는 슬라이더로 조정되며 저장됩니다.", "每次请将卡片放在相同位置。将TwinCode对准红色方框后拍摄。方框位置可用滑块调整并会保存。")}
            </div>

          </div>
        )}



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
                // 라벨 문구가 아니라 key로 매칭한다 (라벨이 바뀌어도 판정이 유실되지 않도록)
                const check = checks.find(c => c.key === f.key) ?? checks.find(c => c.label === f.label(t));
                const status: "pending" | "match" | "fail" = !ready ? "pending" : check?.match ? "match" : "fail";
                const expectedVal = check?.expected ?? f.getExpected(expected);
                const detectedVal = ready
                  ? (check?.detected ?? (side === "front" ? f.getDetected(frontResult!) : f.getDetected(backResult!)))
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
                  <th className="text-left px-4 py-2 font-medium">{t("사진", "照片")}</th>

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
                      {h.frontPhoto || h.backPhoto ? (
                        <button
                          type="button"
                          onClick={() => setPhotoViewer(h)}
                          className="flex items-center gap-1 group"
                          title={t("클릭하면 크게 보기", "点击查看大图")}
                        >
                          {[h.frontPhoto, h.backPhoto].map((src, i) =>
                            src ? (
                              <img
                                key={i}
                                src={src}
                                alt={i === 0 ? t("앞면", "正面") : t("뒷면", "背面")}
                                className="w-12 h-8 object-cover rounded border group-hover:ring-2 ring-primary/60 transition"
                              />
                            ) : (
                              <span key={i} className="w-12 h-8 rounded border grid place-items-center text-[9px] text-muted-foreground">
                                {i === 0 ? t("앞", "正") : t("뒤", "背")}
                              </span>
                            )
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </td>

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

      {/* 촬영 사진 크게 보기 */}
      <Dialog open={!!photoViewer} onOpenChange={(o) => !o && setPhotoViewer(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {t(`카드 ${(photoViewer?.itemIdx ?? 0) + 1} 촬영 사진`, `卡片 ${(photoViewer?.itemIdx ?? 0) + 1} 拍摄照片`)}
              {photoViewer?.cardSerial ? <span className="ml-2 text-xs font-mono text-muted-foreground">{photoViewer.cardSerial}</span> : null}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            {([["front", photoViewer?.frontPhoto, t("앞면", "正面")], ["back", photoViewer?.backPhoto, t("뒷면", "背面")]] as const).map(([k, src, label]) => (
              <div key={k} className="rounded-lg border overflow-hidden bg-muted/20">
                <div className="px-3 py-1.5 text-xs font-semibold border-b bg-muted/30">{label}</div>
                {src ? (
                  <img src={src} alt={label} className="w-full max-h-[70vh] object-contain bg-black/40" />
                ) : (
                  <div className="h-48 grid place-items-center text-xs text-muted-foreground">
                    {t("사진 없음", "无照片")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

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

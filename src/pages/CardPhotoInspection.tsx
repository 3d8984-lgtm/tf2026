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
}

interface OrderRow {
  id: string;
  externalOrderId: string;
  twinker: string;
  product: string;
  dueDate: string;
  items: CardItem[];
}

type FrontExtract = { cp_score: string; card_sequence: string; notes?: string };
type BackExtract = { edition: string; minted_on: string; twincode: string; dm_barcode: string; card_grade: string; notes?: string };

interface FieldCheck {
  label: string;
  expected: string;
  detected: string;
  match: boolean;
}

export default function CardPhotoInspection() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const t = (ko: string, zh: string) => (isKo ? ko : zh);

  const { data: dbOrders } = useOrders();
  const orders = useMemo<OrderRow[]>(() => {
    if (!dbOrders) return [];
    return dbOrders.map((o: any) => {
      const items: CardItem[] = ((o.source_data as any)?.items ?? []).map((it: any) => ({
        card_barcode: it.card_barcode ?? "",
        card_serial: it.card_serial ?? "",
        card_grade: it.card_grade ?? "",
        design_qr: it.design_qr ?? "",
        hologram_qr: it.hologram_qr ?? "",
        twinker: it.twinker ?? o.recipient_name ?? "",
        cp_score: it.cp_score,
        edition: it.edition,
        minted_on: it.minted_on,
        sign: it.sign,
        twincode: it.twincode ?? it.design_qr ?? "",
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
      const { data: files } = await supabase.storage.from("design-images").list(folder);
      if (files) {
        for (const f of files) {
          const k = f.name.replace(/\.[^.]+$/, "");
          map[k] = supabase.storage.from("design-images").getPublicUrl(`${folder}/${f.name}`).data.publicUrl;
        }
      }
      return map;
    },
  });

  const expectedDesignUrl = expected
    ? (designImages?.[expected.design_qr] || designImages?.[expected.twincode || ""])
    : undefined;

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

  const inspectImage = async (side: "front" | "back", dataUrl: string) => {
    setBusySide(side);
    try {
      const { data, error } = await supabase.functions.invoke("card-photo-inspect", {
        body: { side, image: dataUrl },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const ex = data?.extracted;
      if (!ex) throw new Error(t("추출 결과 없음", "无提取结果"));
      if (side === "front") setFrontResult(ex);
      else {
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
    if (side === "front") { setFrontImg(url); setFrontResult(null); }
    else { setBackImg(url); setBackResult(null); }
    await inspectImage(side, url);
  };

  const reset = () => {
    setFrontImg(null); setBackImg(null);
    setFrontResult(null); setBackResult(null);
  };

  // ── Comparison (text fields only) ─────────────────────────────────────
  const norm = (v: any) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

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
        label: t("카드 순번", "卡片序号"),
        expected: expected.card_serial ?? "",
        detected: frontResult.card_sequence ?? "",
        // Loose: detected contains the expected serial (case-insensitive, whitespace stripped)
        match: !!expected.card_serial && norm(frontResult.card_sequence).includes(norm(expected.card_serial)),
      });
    }
    if (backResult) {
      list.push({
        label: "EDITION",
        expected: String(expected.edition ?? ""),
        detected: backResult.edition ?? "",
        match: norm(expected.edition) === norm(backResult.edition) && !!norm(expected.edition),
      });
      list.push({
        label: "Minted on",
        expected: String(expected.minted_on ?? ""),
        detected: backResult.minted_on ?? "",
        match: norm(expected.minted_on) === norm(backResult.minted_on) && !!norm(expected.minted_on),
      });
      list.push({
        label: t("트윈코드", "TwinCode"),
        expected: expected.twincode || expected.design_qr || "",
        detected: backResult.twincode ?? "",
        match: norm(expected.twincode || expected.design_qr) === norm(backResult.twincode)
          && !!norm(expected.twincode || expected.design_qr),
      });
      list.push({
        label: t("DM 바코드", "DM条码"),
        expected: expected.card_barcode ?? "",
        detected: backResult.dm_barcode ?? "",
        match: norm(expected.card_barcode) === norm(backResult.dm_barcode) && !!norm(expected.card_barcode),
      });
      list.push({
        label: t("카드 등급", "卡片等级"),
        expected: expected.card_grade ?? "",
        detected: backResult.card_grade ?? "",
        match: norm(expected.card_grade) === norm(backResult.card_grade) && !!norm(expected.card_grade),
      });
    }
    return list;
  }, [expected, frontResult, backResult, isKo]);

  const failCount = checks.filter(c => !c.match).length;
  const allDone = !!frontResult && !!backResult;

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
                  <th className="text-left px-4 py-2 font-medium">{t("납기", "交期")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer"
                    onClick={() => { setSelectedOrderId(o.id); setSelectedItemIdx(0); }}>
                    <td className="px-4 py-3 font-medium">{o.externalOrderId}</td>
                    <td className="px-4 py-3">{o.twinker}</td>
                    <td className="px-4 py-3">{o.product}</td>
                    <td className="px-4 py-3 tabular-nums">{o.items.length}</td>
                    <td className="px-4 py-3">{o.dueDate}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline">{t("선택", "选择")}</Button>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t("주문이 없습니다", "暂无订单")}</td></tr>
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
            {t("① 뒷면을 먼저 촬영하면 DM 바코드로 주문이 자동 매칭됩니다. ② 그 다음 앞면을 촬영하세요.", "① 先拍摄背面，通过DM条码自动匹配订单。② 然后拍摄正面。")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => captureSide("back")} disabled={!stream || busySide !== null}>
              {busySide === "back" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {t("① 뒷면 촬영 & 분석", "① 拍摄并分析背面")}
            </Button>
            <Button onClick={() => captureSide("front")} disabled={!stream || busySide !== null} variant="secondary">
              {busySide === "front" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {t("② 앞면 촬영 & 분석", "② 拍摄并分析正面")}
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
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> {t("등록된 이미지 (작업자 비교용)", "已登记图像 (供操作员对比)")}
            </div>
            <div className="aspect-[3/4] bg-muted/20 flex items-center justify-center">
              {expectedDesignUrl ? (
                <img src={expectedDesignUrl} alt="registered design" className="w-full h-full object-contain" />
              ) : (
                <div className="text-muted-foreground text-sm">{t("등록 이미지 없음", "无已登记图像")}</div>
              )}
            </div>
            {expected?.sign && (
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
                      {status === "match" && <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />}
                      {status === "fail" && <XCircle className="w-4 h-4 text-[hsl(var(--warning))]" />}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

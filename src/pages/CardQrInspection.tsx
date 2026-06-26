import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useOrders } from "@/hooks/useDbData";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, CheckCircle2, XCircle, RotateCcw, ChevronLeft, Package, Image as ImageIcon } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

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

interface ScanResult {
  scannedAt: number;
  barcode: string;
  card?: CardItem;
  designImageUrl?: string;
  found: boolean;
}

interface HistoryEntry {
  id: string;
  orderId: string;
  at: number;
  barcodes: string[];
  serials: string[];
  ok: boolean;
  reason: string;
}

const QR_HISTORY_KEY = "card-qr-inspect-history";

export default function CardQrInspection() {
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

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const order = orders.find(o => o.id === selectedOrderId) ?? null;

  // Image storage for selected order's design folder
  const { data: designImages } = useQuery({
    queryKey: ["card-inspect-design", order?.externalOrderId],
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

  const [scans, setScans] = useState<ScanResult[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (order) inputRef.current?.focus();
  }, [order, scans.length]);

  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(QR_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(QR_HISTORY_KEY, JSON.stringify(history)); } catch {}
  }, [history]);

  const reset = useCallback(() => {
    setScans([]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // When switching orders, reset scans only (keep persistent history)
  useEffect(() => { reset(); }, [selectedOrderId, reset]);

  const handleScan = (raw: string) => {
    const code = raw.trim();
    if (!code || !order) return;
    const card = order.items.find(it => it.card_barcode === code);
    const result: ScanResult = {
      scannedAt: Date.now(),
      barcode: code,
      card,
      designImageUrl: card ? (designImages?.[card.design_qr] || designImages?.[card.twincode || ""]) : undefined,
      found: !!card,
    };
    setScans(prev => {
      const next = prev.length >= 3 ? [result] : [...prev, result];
      return next;
    });
    setInput("");
  };

  // Verify 3 cards are consecutive (by card_serial trailing digits)
  const verification = useMemo(() => {
    if (scans.length < 3) return null;
    if (scans.some(s => !s.found)) return { ok: false, reason: t("주문에 없는 카드가 포함됨", "包含订单外的卡片") };
    const serials = scans.map(s => s.card!.card_serial);
    const nums = serials.map(s => {
      const m = s.match(/(\d+)$/);
      return m ? parseInt(m[1], 10) : NaN;
    });
    if (nums.some(n => isNaN(n))) return { ok: false, reason: t("카드 시리얼 형식 오류", "卡片序列号格式错误") };
    const prefixes = serials.map(s => s.replace(/\d+$/, ""));
    if (!prefixes.every(p => p === prefixes[0])) return { ok: false, reason: t("시리얼 접두사가 일치하지 않음", "序列号前缀不一致") };
    const sorted = [...nums].sort((a, b) => a - b);
    const consecutive = sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
    return consecutive
      ? { ok: true, reason: t("3장 연속 카드 확인됨", "已确认3张连续卡片") }
      : { ok: false, reason: t("카드가 연속되지 않음", "卡片不连续") };
  }, [scans, isKo]);

  // Append to history when 3 scans + verification ready
  const lastLoggedRef = useRef<string>("");
  useEffect(() => {
    if (scans.length === 3 && verification) {
      const key = scans.map(s => s.scannedAt).join("-");
      if (lastLoggedRef.current === key) return;
      lastLoggedRef.current = key;
      setHistory(prev => [{
        id: key,
        at: Date.now(),
        barcodes: scans.map(s => s.barcode),
        serials: scans.map(s => s.card?.card_serial ?? "-"),
        ok: verification.ok,
        reason: verification.reason,
      }, ...prev].slice(0, 50));
    }
  }, [scans, verification]);


  // ─── Order list view ──────────────────────────────────────────────────
  if (!order) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title={t("카드 QR코드 검사", "卡片QR码检验")}
          description={t("주문을 선택한 후 카드 DM 바코드 3개를 연속 스캔하여 연속 카드 여부를 검증합니다", "选择订单后连续扫描3个卡片DM条码以验证连续性")}
        />
        <div className="flex-1 overflow-auto p-6">
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
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
                  <tr key={o.id} className="border-t hover:bg-muted/20 cursor-pointer" onClick={() => setSelectedOrderId(o.id)}>
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

  // ─── Scan view ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <PageHeader title={t("카드 QR코드 검사", "卡片QR码检验")} description={`${order.externalOrderId} · ${order.twinker}`}>
        <Button variant="outline" size="sm" onClick={() => setSelectedOrderId(null)}>
          <ChevronLeft className="w-4 h-4" /> {t("주문 목록", "订单列表")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => {
          const demo: ScanResult = {
            scannedAt: Date.now(),
            barcode: "DM-2026-0501-00731",
            found: true,
            card: {
              card_barcode: "DM-2026-0501-00731",
              card_serial: "TM-CARD-A0731",
              card_grade: "S",
              design_qr: "DSGN-TWIN-007",
              hologram_qr: "HOLO-2026-A731",
              twinker: "Sasha Kim",
              cp_score: 8420,
              edition: "12 / 50",
              minted_on: "2026-04-22",
              sign: "S.Kim ✦",
              twincode: "TWN-007-A",
            },
            designImageUrl: undefined,
          };
          setScans(prev => (prev.length >= 3 ? [demo] : [...prev, demo]));
        }}>
          <ScanLine className="w-4 h-4" /> {t("데모 스캔", "演示扫描")}
        </Button>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="w-4 h-4" /> {t("초기화", "重置")}
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Scan input */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <ScanLine className="w-5 h-5 text-primary" />
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(input); } }}
              placeholder={t(`DM 바코드를 스캔하세요 (${scans.length}/3)`, `请扫描DM条码 (${scans.length}/3)`)}
              className="text-base"
              autoFocus
            />
            <span className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">{scans.length}/3</span>
          </div>
        </div>

        {/* Result banner */}
        {verification && (
          <div className={`rounded-lg border p-4 flex items-center gap-3 ${
            verification.ok
              ? "bg-[hsl(var(--success)/0.1)] border-[hsl(var(--success)/0.3)] text-[hsl(var(--success))]"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}>
            {verification.ok ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
            <div>
              <div className="font-semibold">{verification.ok ? t("검증 통과", "验证通过") : t("검증 실패", "验证失败")}</div>
              <div className="text-sm opacity-90">{verification.reason}</div>
            </div>
          </div>
        )}

        {/* Card details grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => {
            const s = scans[i];
            return (
              <div key={i} className={`rounded-lg border bg-card overflow-hidden ${
                !s ? "border-dashed" : s.found ? "" : "border-destructive/40"
              }`}>
                <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t(`카드 ${i + 1}`, `卡片 ${i + 1}`)}</span>
                  {s && (s.found
                    ? <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />
                    : <XCircle className="w-4 h-4 text-destructive" />
                  )}
                </div>

                {!s ? (
                  <div className="aspect-[3/4] flex flex-col items-center justify-center text-muted-foreground">
                    <Package className="w-8 h-8 mb-2 opacity-40" />
                    <span className="text-xs">{t("스캔 대기", "等待扫描")}</span>
                  </div>
                ) : !s.found ? (
                  <div className="p-4 text-sm">
                    <div className="font-medium text-destructive mb-1">{t("주문에 없는 카드", "订单中无此卡片")}</div>
                    <div className="text-xs text-muted-foreground break-all">DM: {s.barcode}</div>
                  </div>
                ) : (
                  <div>
                    <div className="h-52 bg-muted/20 flex items-center justify-center overflow-hidden">
                      {s.designImageUrl ? (
                        <img src={s.designImageUrl} alt="card" className="w-full h-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center text-muted-foreground">
                          <ImageIcon className="w-8 h-8 mb-1 opacity-40" />
                          <span className="text-xs">{t("이미지 없음", "无图")}</span>
                        </div>
                      )}
                    </div>
                    <dl className="p-4 text-base space-y-2.5">
                      <Row label={t("카드 고유번호", "卡片编号")} value={s.card!.card_serial} />
                      <Row label={t("CP 점수", "CP分数")} value={s.card!.cp_score ?? "-"} />
                      <Row label={t("트윈커", "Twinker")} value={s.card!.twinker} />
                      <Row label="EDITION" value={s.card!.edition ?? "-"} />
                      <Row label="Minted on" value={s.card!.minted_on ?? "-"} />
                      <Row label={t("싸인", "签名")} value={s.card!.sign ?? "-"} />
                      <Row label={t("등급", "等级")} value={s.card!.card_grade} />
                      <Row label={t("트윈코드", "TwinCode")} value={s.card!.twincode || s.card!.design_qr} />
                      <Row label={t("DM 바코드", "DM条码")} value={s.card!.card_barcode} />
                    </dl>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Scan history */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
            <div className="text-sm font-semibold">{t("스캔 검사 이력", "扫描检验历史")}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {t(`총 ${history.length}건`, `共 ${history.length} 条`)}
            </div>
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("이력이 없습니다", "暂无历史")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-muted-foreground text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium w-40">{t("시각", "时间")}</th>
                  <th className="text-left px-4 py-2 font-medium w-24">{t("결과", "结果")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("카드 시리얼", "卡片序列号")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("DM 바코드", "DM条码")}</th>
                  <th className="text-left px-4 py-2 font-medium">{t("사유", "原因")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-t">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {new Date(h.at).toLocaleTimeString(isKo ? "ko-KR" : "zh-CN")}
                    </td>
                    <td className="px-4 py-2">
                      {h.ok ? (
                        <span className="inline-flex items-center gap-1 text-[hsl(var(--success))]">
                          <CheckCircle2 className="w-4 h-4" /> {t("통과", "通过")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle className="w-4 h-4" /> {t("실패", "失败")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{h.serials.join(", ")}</td>
                    <td className="px-4 py-2 font-mono text-xs break-all">{h.barcodes.join(", ")}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{h.reason}</td>
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

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="font-medium text-right break-all">{value}</dd>
    </div>
  );
}

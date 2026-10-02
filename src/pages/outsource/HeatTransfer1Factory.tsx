import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { downloadZip } from "client-zip";
import { ChevronLeft, Copy, Download, Loader2, Plus, Save, Trash2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { useGlobalSetting } from "@/hooks/useGlobalSetting";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import PatternStudio7, { normalizeSaved, serializeSaved, type Saved } from "@/lib/pattern7/PatternStudio7";
import PatternFrame from "@/lib/pattern7/PatternFrame";
import { mmToPx, renderPatternPng, resolveItemPattern, urlToDataUrl } from "@/lib/pattern7/renderPng";
import {
  OrderListCard, WorkOrderInfoBox, QrTab, fmtDate, resolveGrade, triggerDownload,
  type OrderRow, type DesignDetail,
} from "./HeatTransferFactory";

const SIZES_KEY = "ht1:pattern_sizes";
const FORMAT_PREFIX = "ht1:pattern_format:";
const DEFAULT_SIZES = ["공통", "S", "M", "L", "XL", "2XL"];
const COMMON = "공통";

type StoredFormat = ReturnType<typeof serializeSaved> & { printMm?: number; dpi?: number };

const normSize = (s: string) => (s || "").toString().trim().toUpperCase().replace(/\s+/g, "");

async function saveFormat(size: string, value: StoredFormat) {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase.from("app_ui_settings").upsert(
    { setting_key: FORMAT_PREFIX + size, setting_value: value as never, updated_by: auth.user?.id ?? null },
    { onConflict: "setting_key" },
  );
  if (error) throw new Error(error.message);
}

/** Load every size format from the server (shared across all users/devices). */
function useAllFormats() {
  const [map, setMap] = useState<Record<string, StoredFormat>>({});
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("app_ui_settings").select("setting_key, setting_value").like("setting_key", `${FORMAT_PREFIX}%`);
    const next: Record<string, StoredFormat> = {};
    for (const r of data || []) next[r.setting_key.slice(FORMAT_PREFIX.length)] = r.setting_value as unknown as StoredFormat;
    setMap(next);
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { map, setMap, loading, reload };
}

function pickFormat(map: Record<string, StoredFormat>, size: string): { key: string; fmt: StoredFormat } | null {
  const t = normSize(size);
  const keys = Object.keys(map);
  const exact = keys.find((k) => normSize(k) === t);
  if (exact) return { key: exact, fmt: map[exact] };
  if (map[COMMON]) return { key: COMMON, fmt: map[COMMON] };
  return keys.length ? { key: keys[0], fmt: map[keys[0]] } : null;
}

export default function HeatTransfer1Factory() {
  const { t } = useLang();
  const { data: dbOrders } = useOrders();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("order");
  const formats = useAllFormats();

  const orders: OrderRow[] = useMemo(() => (dbOrders || []).map((o: any) => {
    const items = (o.source_data?.items as any[]) || [];
    return {
      id: o.id, orderNo: o.external_order_id, receivedAt: fmtDate(o.created_at), dueDate: fmtDate(o.project_completed_at),
      twinker: o.recipient_name || items[0]?.twinker || "", workQty: o.quantity || items.length || 1,
      designQty: items.length || 1, logoUrl: o.logo_url || null, items, raw: o,
    };
  }), [dbOrders]);

  const active = orders.find((o) => o.id === activeId) || null;
  const openOrder = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("order", id); else next.delete("order");
    setParams(next);
  };

  return (
    <div>
      <PageHeader title={t("menu.outHeatTransfer1") || "열전사 디자인 공장1"} description="패턴 스튜디오 기반 사이즈별 디자인 포맷 + 주문별 자동 디자인 생성" />
      <div className="p-6 space-y-4">
        {!active ? (
          <>
            <FormatSettingsCard formats={formats} />
            <OrderListCard orders={orders} onOpen={openOrder} factory="heat-transfer-1" />
          </>
        ) : (
          <OrderDetail1 order={active} formatMap={formats.map} onBack={() => openOrder(null)} />
        )}
      </div>
    </div>
  );
}

// ================= design format settings =================

function FormatSettingsCard({ formats }: { formats: ReturnType<typeof useAllFormats> }) {
  const sizesSetting = useGlobalSetting<string[]>(SIZES_KEY, DEFAULT_SIZES);
  const sizes = sizesSetting.value?.length ? sizesSetting.value : DEFAULT_SIZES;
  const [size, setSize] = useState<string>(COMMON);
  const [draft, setDraft] = useState<Saved>(() => normalizeSaved(null));
  const [printMm, setPrintMm] = useState(120);
  const [dpi, setDpi] = useState(300);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newSize, setNewSize] = useState("");

  // Load the selected size's format when switching tabs or after server reload.
  useEffect(() => {
    if (formats.loading || dirty) return;
    const f = formats.map[size];
    setDraft(normalizeSaved(f));
    setPrintMm(f?.printMm ?? 120);
    setDpi(f?.dpi ?? 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, formats.loading, formats.map]);

  const switchSize = (s: string) => {
    if (dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 이동할까요?")) return;
    setDirty(false);
    setSize(s);
  };

  const current = (): StoredFormat => ({ ...serializeSaved(draft), printMm, dpi });

  const save = async () => {
    setSaving(true);
    try {
      const v = current();
      await saveFormat(size, v);
      formats.setMap((m) => ({ ...m, [size]: v }));
      setDirty(false);
      toast({ title: "디자인 포맷 저장됨", description: `${size} 사이즈 · 모든 컴퓨터에 공유됩니다.` });
    } catch (e: any) {
      toast({ title: "저장 실패", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const copyToOthers = async () => {
    if (!confirm(`${size} 설정을 다른 모든 사이즈에 덮어쓸까요?`)) return;
    setSaving(true);
    try {
      const v = current();
      const patch: Record<string, StoredFormat> = {};
      for (const s of sizes) { await saveFormat(s, v); patch[s] = v; }
      formats.setMap((m) => ({ ...m, ...patch }));
      setDirty(false);
      toast({ title: "모든 사이즈에 복사됨" });
    } catch (e: any) {
      toast({ title: "복사 실패", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const addSize = async () => {
    const s = newSize.trim();
    if (!s || sizes.some((x) => normSize(x) === normSize(s))) return;
    try { await sizesSetting.persist([...sizes, s]); setNewSize(""); } catch (e: any) { toast({ title: "추가 실패", description: e?.message, variant: "destructive" }); }
  };
  const removeSize = async (s: string) => {
    if (s === COMMON || !confirm(`${s} 사이즈를 목록에서 삭제할까요?`)) return;
    try {
      await sizesSetting.persist(sizes.filter((x) => x !== s));
      await supabase.from("app_ui_settings").delete().eq("setting_key", FORMAT_PREFIX + s);
      formats.setMap((m) => { const n = { ...m }; delete n[s]; return n; });
      if (size === s) { setDirty(false); setSize(COMMON); }
    } catch (e: any) { toast({ title: "삭제 실패", description: e?.message, variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base">사이즈별 디자인 포맷 설정</CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          {dirty && <Badge variant="outline">저장 안 됨</Badge>}
          <Button size="sm" variant="outline" onClick={copyToOthers} disabled={saving}><Copy className="w-4 h-4 mr-1" />다른 사이즈에 복사</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}저장</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {sizes.map((s) => (
            <div key={s} className="flex items-center">
              <Button size="sm" variant={s === size ? "default" : "outline"} onClick={() => switchSize(s)}>
                {s}{formats.map[s] ? "" : " ·미설정"}
              </Button>
              {s !== COMMON && <button className="ml-0.5 text-muted-foreground hover:text-destructive" onClick={() => removeSize(s)} aria-label={`${s} 삭제`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          <Input value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="사이즈 추가" className="h-8 w-28" onKeyDown={(e) => e.key === "Enter" && addSize()} />
          <Button size="sm" variant="ghost" onClick={addSize}><Plus className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-end gap-4 flex-wrap text-sm">
          <div className="space-y-1"><Label>출력 크기 (mm, 정사각)</Label><Input type="number" className="h-8 w-28" value={printMm} min={20} max={600} onChange={(e) => { setPrintMm(+e.target.value || 120); setDirty(true); }} /></div>
          <div className="space-y-1"><Label>해상도 (DPI)</Label><Input type="number" className="h-8 w-28" value={dpi} min={72} max={1200} onChange={(e) => { setDpi(+e.target.value || 300); setDirty(true); }} /></div>
          <div className="text-xs text-muted-foreground pb-2">PNG {mmToPx(printMm, dpi)}×{mmToPx(printMm, dpi)}px · 주문 품목의 티셔츠 사이즈와 같은 포맷이 없으면 '공통' 포맷을 사용합니다.</div>
        </div>
        {formats.loading ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" />불러오는 중</div>
        ) : (
          <PatternStudio7 value={draft} onChange={(n) => { setDraft(n); setDirty(true); }} />
        )}
      </CardContent>
    </Card>
  );
}

// ================= order detail =================

type ItemRow = DesignDetail & { artUrl: string | null; formatKey: string | null };

function OrderDetail1({ order, formatMap, onBack }: { order: OrderRow; formatMap: Record<string, StoredFormat>; onBack: () => void }) {
  const details: ItemRow[] = useMemo(() => {
    const n = Math.max(order.items.length, 1);
    return Array.from({ length: n }, (_, i) => {
      const it: any = order.items[i] || {};
      const orderId = String(it.order_id ?? "").trim() || order.orderNo;
      const size = String(it.tshirt_size ?? "").trim();
      const art = it.front_image_url || it.gft_original_image_url || order.logoUrl || null;
      return {
        serial: i + 1, orderNo: orderId, designUid: `${orderId}-2`, designSrc: art,
        tshirtType: String(it.tshirt_type ?? "").trim(), tshirtColor: String(it.tshirt_color ?? "").trim(),
        tshirtSize: size, grade: resolveGrade(it, order.raw), artUrl: art,
        formatKey: pickFormat(formatMap, size)?.key ?? null,
      };
    });
  }, [order, formatMap]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const renderOne = async (d: ItemRow) => {
    const pf = pickFormat(formatMap, d.tshirtSize);
    if (!pf) throw new Error("저장된 디자인 포맷이 없습니다.");
    const fmt = normalizeSaved(pf.fmt);
    const art = d.artUrl ? await urlToDataUrl(d.artUrl) : null;
    const r = await resolveItemPattern(fmt, d.designUid, art);
    const px = mmToPx(pf.fmt.printMm ?? 120, pf.fmt.dpi ?? 300);
    return renderPatternPng({ ...r, artDataUrl: art, sizePx: px });
  };
  const fileName = (d: ItemRow) => `${String(d.serial).padStart(3, "0")}_${d.designUid}_${d.tshirtSize || "NA"}.png`;

  const downloadOne = async (d: ItemRow) => {
    setBusy(true);
    try { triggerDownload(await renderOne(d), fileName(d)); }
    catch (e: any) { toast({ title: "PNG 생성 실패", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const downloadAll = async () => {
    setBusy(true); setProgress(0);
    try {
      const files: { name: string; input: Blob }[] = [];
      for (let i = 0; i < details.length; i++) {
        files.push({ name: fileName(details[i]), input: await renderOne(details[i]) });
        setProgress(Math.round(((i + 1) / details.length) * 100));
      }
      const zip = await downloadZip(files).blob();
      triggerDownload(zip, `열전사1_${order.orderNo}_디자인.zip`);
      toast({ title: "ZIP 다운로드 완료", description: `${files.length}개 PNG` });
    } catch (e: any) {
      toast({ title: "ZIP 생성 실패", description: e?.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> 목록으로</Button>
          <h2 className="text-base font-semibold">작업번호 <span className="font-mono">{order.orderNo}</span></h2>
        </div>
        <Button size="sm" onClick={downloadAll} disabled={busy || !Object.keys(formatMap).length}>
          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}작업파일 PNG 전체 ZIP
        </Button>
      </div>
      {busy && progress > 0 && <Progress value={progress} />}
      {!Object.keys(formatMap).length && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">저장된 디자인 포맷이 없습니다. 목록 화면에서 사이즈별 디자인 포맷을 먼저 저장하세요.</CardContent></Card>
      )}

      <WorkOrderInfoBox order={order} />

      <Tabs defaultValue="design">
        <TabsList>
          <TabsTrigger value="design">디자인 시안</TabsTrigger>
          <TabsTrigger value="qr">큐알코드 시안</TabsTrigger>
        </TabsList>
        <TabsContent value="design">
          <Card>
            <CardHeader><CardTitle className="text-base">주문 상세 목록</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">순번</TableHead>
                    <TableHead>디자인 UID</TableHead>
                    <TableHead>타입</TableHead>
                    <TableHead>색상</TableHead>
                    <TableHead>사이즈</TableHead>
                    <TableHead>적용 포맷</TableHead>
                    <TableHead>시안</TableHead>
                    <TableHead className="text-right">PNG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details.map((d) => (
                    <TableRow key={d.serial}>
                      <TableCell>{d.serial}</TableCell>
                      <TableCell className="font-mono text-xs">{d.designUid}</TableCell>
                      <TableCell>{d.tshirtType || "-"}</TableCell>
                      <TableCell>{d.tshirtColor || "-"}</TableCell>
                      <TableCell>{d.tshirtSize || "-"}</TableCell>
                      <TableCell>{d.formatKey ? <Badge variant="secondary">{d.formatKey}</Badge> : <Badge variant="destructive">없음</Badge>}</TableCell>
                      <TableCell><ItemPreview item={d} formatMap={formatMap} /></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" disabled={busy || !d.formatKey} onClick={() => downloadOne(d)}><Download className="w-4 h-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="qr"><QrTab details={details} /></TabsContent>
      </Tabs>
    </div>
  );
}

function ItemPreview({ item, formatMap }: { item: ItemRow; formatMap: Record<string, StoredFormat> }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof resolveItemPattern>> & { art: string | null } | null>(null);
  const [err, setErr] = useState(false);
  const ref = useRef(0);
  useEffect(() => {
    const pf = pickFormat(formatMap, item.tshirtSize);
    if (!pf) { setState(null); return; }
    const id = ++ref.current;
    (async () => {
      try {
        const art = item.artUrl ? await urlToDataUrl(item.artUrl) : null;
        const r = await resolveItemPattern(normalizeSaved(pf.fmt), item.designUid, art);
        if (id === ref.current) setState({ ...r, art });
      } catch { if (id === ref.current) setErr(true); }
    })();
  }, [item, formatMap]);
  if (err) return <span className="text-xs text-destructive">이미지 오류</span>;
  if (!state) return <div className="w-[140px] h-[140px] rounded bg-muted animate-pulse" />;
  return (
    <div className="w-[140px]">
      <PatternFrame p={state.p} shapes={state.shapes} bgShapes={state.bgShapes} artUrl={state.art} frameW={140} plain frameSvg={state.frameSvg} />
    </div>
  );
}

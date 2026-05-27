import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Image, Type, QrCode, Barcode, Loader2, FileDown } from "lucide-react";

const CARD_W_MM = 57;
const CARD_H_MM = 87;
const PX_PER_MM = 3.7795275591; // 96dpi

type Side = "front" | "back";
type ElType = "image" | "text" | "qr" | "barcode";

interface CardElement {
  id: string;
  template_id: string;
  side: Side;
  field_name: string;
  element_type: ElType;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  font_size_pt: number | null;
  font_family: string | null;
  font_color: string | null;
  text_align: "left" | "center" | "right" | null;
  rotation_deg: number;
  z_index: number;
}

interface CardTemplate {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  front_pdf_url: string | null;
  front_preview_png_url: string | null;
  back_pdf_url: string | null;
  back_preview_png_url: string | null;
}

const ICONS: Record<ElType, any> = { image: Image, text: Type, qr: QrCode, barcode: Barcode };

const DEFAULTS: Record<ElType, Partial<CardElement>> = {
  image: { width_mm: 20, height_mm: 20 },
  text: { width_mm: 30, height_mm: 6, font_size_pt: 10, font_color: "#000000", text_align: "left", font_family: "Helvetica" },
  qr: { width_mm: 12, height_mm: 12 },
  barcode: { width_mm: 25, height_mm: 8 },
};

const FIELD_PRESET: Record<ElType, string> = {
  image: "character_image",
  text: "cp_value",
  qr: "twin_code_image",
  barcode: "dm_barcode_image",
};

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/* ------------------- Preview Card ------------------- */
function PreviewCard({
  side,
  template,
  elements,
  selectedId,
  onSelect,
  onCommit,
  containerWidth,
}: {
  side: Side;
  template: CardTemplate;
  elements: CardElement[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, patch: Partial<CardElement>) => void;
  containerWidth: number;
}) {
  // Scale to fit container, then enlarge 1.5x for legibility
  const cardPxAt96 = CARD_W_MM * PX_PER_MM;
  const fitScale = Math.max(1, (containerWidth - 8) / cardPxAt96);
  const scale = fitScale * 1.5;



  const previewUrl = side === "front" ? template.front_preview_png_url : template.back_preview_png_url;
  const visible = elements.filter((e) => e.side === side);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<null | {
    id: string;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: CardElement;
    current: Partial<CardElement>;
  }>(null);

  const onPointerDown = (e: React.PointerEvent, el: CardElement, mode: "move" | "resize") => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(el.id);
    setDrag({ id: el.id, mode, startX: e.clientX, startY: e.clientY, start: el, current: {} });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dxMm = (e.clientX - drag.startX) / (scale * PX_PER_MM);
    const dyMm = (e.clientY - drag.startY) / (scale * PX_PER_MM);
    let patch: Partial<CardElement>;
    if (drag.mode === "move") {
      patch = {
        x_mm: round2(Math.max(0, Math.min(CARD_W_MM - drag.start.width_mm, drag.start.x_mm + dxMm))),
        y_mm: round2(Math.max(0, Math.min(CARD_H_MM - drag.start.height_mm, drag.start.y_mm + dyMm))),
      };
    } else {
      patch = {
        width_mm: round2(Math.max(2, Math.min(CARD_W_MM - drag.start.x_mm, drag.start.width_mm + dxMm))),
        height_mm: round2(Math.max(2, Math.min(CARD_H_MM - drag.start.y_mm, drag.start.height_mm + dyMm))),
      };
    }
    setDrag({ ...drag, current: patch });
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (Object.keys(drag.current).length) onCommit(drag.id, drag.current);
    setDrag(null);
  };

  return (
    <div
      ref={wrapperRef}
      className="relative bg-muted/40 rounded-md p-2 overflow-auto"
      onClick={() => onSelect(null)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        style={{
          width: `calc(${CARD_W_MM}mm * ${scale})`,
          height: `calc(${CARD_H_MM}mm * ${scale})`,
        }}
      >

        <div
          className="origin-top-left"
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <div
            style={{
              width: `${CARD_W_MM}mm`,
              height: `${CARD_H_MM}mm`,
              position: "relative",
              background: "white",
              boxShadow: "0 1px 4px hsl(var(--foreground) / 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {previewUrl && (
              <img
                src={previewUrl}
                alt={side}
                draggable={false}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${CARD_W_MM}mm`,
                  height: `${CARD_H_MM}mm`,
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            )}
            {visible.map((el) => {
              const live = drag?.id === el.id ? { ...el, ...drag.current } : el;
              const selected = selectedId === el.id;
              const Icn = ICONS[el.element_type];
              return (
                <div
                  key={el.id}
                  onPointerDown={(e) => onPointerDown(e, live as CardElement, "move")}
                  style={{
                    position: "absolute",
                    left: `${live.x_mm}mm`,
                    top: `${live.y_mm}mm`,
                    width: `${live.width_mm}mm`,
                    height: `${live.height_mm}mm`,
                    border: selected ? "1.5px solid hsl(var(--primary))" : "1px dashed #00aaff",
                    background: selected ? "hsl(var(--primary) / 0.08)" : "transparent",
                    cursor: "move",
                    transform: el.rotation_deg ? `rotate(${el.rotation_deg}deg)` : undefined,
                    transformOrigin: "center",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      fontSize: 8,
                      lineHeight: "10px",
                      background: "#00aaff",
                      color: "white",
                      padding: "0 3px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Icn className="w-2.5 h-2.5 inline mr-0.5" />
                    {el.field_name}
                  </div>
                  {selected && (
                    <div
                      onPointerDown={(e) => onPointerDown(e, live as CardElement, "resize")}
                      style={{
                        position: "absolute",
                        right: -5,
                        bottom: -5,
                        width: 10,
                        height: 10,
                        background: "hsl(var(--primary))",
                        cursor: "nwse-resize",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">스케일 {scale.toFixed(2)}× · 실제 카드 크기 {CARD_W_MM}×{CARD_H_MM}mm</p>
    </div>
  );
}

/* ------------------- Page ------------------- */
export default function CardTemplateDetail() {
  const { id } = useParams<{ id: string }>();
  const [template, setTemplate] = useState<CardTemplate | null>(null);
  const [elements, setElements] = useState<CardElement[]>([]);
  const [side, setSide] = useState<Side>("front");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [containerW, setContainerW] = useState(600);
  const [genLoading, setGenLoading] = useState(false);
  const leftRef = useRef<HTMLDivElement | null>(null);

  const debouncers = useRef<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [tplRes, elRes] = await Promise.all([
      supabase.from("card_template").select("*").eq("id", id).single(),
      supabase.from("card_element").select("*").eq("template_id", id).order("z_index"),
    ]);
    if (tplRes.error) toast.error(tplRes.error.message);
    if (elRes.error) toast.error(elRes.error.message);
    setTemplate(tplRes.data as CardTemplate);
    setElements((elRes.data ?? []) as CardElement[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerW(e.contentRect.width);
    });
    if (leftRef.current) ro.observe(leftRef.current);
    return () => ro.disconnect();
  }, []);

  const commit = useCallback((elId: string, patch: Partial<CardElement>) => {
    setElements((prev) => prev.map((el) => (el.id === elId ? { ...el, ...patch } as CardElement : el)));
    const existing = debouncers.current.get(elId);
    if (existing) clearTimeout(existing);
    const t = window.setTimeout(async () => {
      const { error } = await supabase.from("card_element").update(patch).eq("id", elId);
      if (error) toast.error(error.message);
    }, 300);
    debouncers.current.set(elId, t);
  }, []);

  const addElement = async (type: ElType) => {
    if (!id) return;
    const def = DEFAULTS[type];
    const { data, error } = await supabase
      .from("card_element")
      .insert({
        template_id: id,
        side,
        field_name: FIELD_PRESET[type],
        element_type: type,
        x_mm: 5,
        y_mm: 5,
        width_mm: def.width_mm ?? 20,
        height_mm: def.height_mm ?? 20,
        font_size_pt: def.font_size_pt ?? null,
        font_family: def.font_family ?? null,
        font_color: def.font_color ?? null,
        text_align: def.text_align ?? null,
        rotation_deg: 0,
        z_index: elements.length,
      })
      .select()
      .single();
    if (error) { toast.error(error.message); return; }
    setElements((p) => [...p, data as CardElement]);
    setSelectedId((data as CardElement).id);
  };

  const deleteElement = async (elId: string) => {
    const { error } = await supabase.from("card_element").delete().eq("id", elId);
    if (error) { toast.error(error.message); return; }
    setElements((p) => p.filter((e) => e.id !== elId));
    if (selectedId === elId) setSelectedId(null);
  };

  const sideElements = useMemo(() => elements.filter((e) => e.side === side), [elements, side]);

  const handleTestPdf = async () => {
    if (!id) return;
    setGenLoading(true);
    try {
      // build sample data
      const data: Record<string, any> = {};
      for (const el of elements) {
        if (el.element_type === "text") data[el.field_name] = "SAMPLE";
        else {
          // gray placeholder PNG via data URL
          data[el.field_name] = "https://placehold.co/400x400/cccccc/666666.png?text=SAMPLE";
        }
      }
      const res = await supabase.functions.invoke("generate-card-pdf", {
        body: { template_id: id, data },
      });
      if (res.error) throw res.error;
      const url = (res.data as any)?.pdf_url;
      if (!url) throw new Error("PDF 생성 실패");
      window.open(url, "_blank");
      toast.success("테스트 PDF가 생성되었습니다.");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF 생성 실패");
    } finally {
      setGenLoading(false);
    }
  };

  if (loading || !template) {
    return (
      <div className="p-10 flex items-center text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={template.name} description="요소를 추가하고 카드 위 위치를 mm 단위로 설정합니다.">
        <Link to="/outsource/card-order/templates">
          <Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> 목록</Button>
        </Link>
        <Button size="sm" onClick={handleTestPdf} disabled={genLoading}>
          {genLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileDown className="w-4 h-4 mr-1" />}
          테스트 PDF 출력
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 p-4">
        {/* Left: preview */}
        <div className="lg:col-span-3 space-y-3" ref={leftRef}>
          <div className="flex gap-2">
            {(["front", "back"] as Side[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={side === s ? "default" : "outline"}
                onClick={() => { setSide(s); setSelectedId(null); }}
              >
                {s === "front" ? "앞면" : "뒷면"}
              </Button>
            ))}
          </div>
          <PreviewCard
            side={side}
            template={template}
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onCommit={commit}
            containerWidth={containerW}
          />
        </div>

        {/* Right: panel */}
        <div className="lg:col-span-2 space-y-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="w-full"><Plus className="w-4 h-4 mr-1" /> 요소 추가</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => addElement("image")}><Image className="w-4 h-4 mr-2" /> 이미지</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addElement("text")}><Type className="w-4 h-4 mr-2" /> 텍스트</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addElement("qr")}><QrCode className="w-4 h-4 mr-2" /> QR 코드</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addElement("barcode")}><Barcode className="w-4 h-4 mr-2" /> 바코드 (DM)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
            {sideElements.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6 border rounded-md">
                {side === "front" ? "앞면" : "뒷면"}에 요소가 없습니다.
              </div>
            )}
            {sideElements.map((el) => (
              <ElementCard
                key={el.id}
                el={el}
                selected={selectedId === el.id}
                onSelect={() => setSelectedId(el.id)}
                onCommit={(p) => commit(el.id, p)}
                onDelete={() => deleteElement(el.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------- Element card (right panel) ------------------- */
function ElementCard({
  el, selected, onSelect, onCommit, onDelete,
}: {
  el: CardElement;
  selected: boolean;
  onSelect: () => void;
  onCommit: (patch: Partial<CardElement>) => void;
  onDelete: () => void;
}) {
  const Icn = ICONS[el.element_type];
  const numField = (
    label: string, key: keyof CardElement, step = 0.1,
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        value={(el[key] as number) ?? 0}
        onChange={(e) => onCommit({ [key]: parseFloat(e.target.value) || 0 } as any)}
        className="h-7 text-xs"
      />
    </div>
  );

  return (
    <div
      onClick={onSelect}
      className={`border rounded-md p-3 space-y-2 cursor-pointer ${selected ? "border-primary bg-primary/5" : "bg-card"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Icn className="w-3.5 h-3.5" />
          <span className="uppercase text-muted-foreground">{el.element_type}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">필드명 (field_name)</Label>
        <Input
          value={el.field_name}
          onChange={(e) => onCommit({ field_name: e.target.value })}
          className="h-7 text-xs font-mono"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {numField("X (mm)", "x_mm")}
        {numField("Y (mm)", "y_mm")}
        {numField("너비 (mm)", "width_mm")}
        {numField("높이 (mm)", "height_mm")}
        {numField("회전 (°)", "rotation_deg", 1)}
      </div>

      {el.element_type === "text" && (
        <div className="grid grid-cols-2 gap-2 pt-1 border-t">
          {numField("폰트 (pt)", "font_size_pt", 0.5)}
          <div className="space-y-1">
            <Label className="text-xs">색상</Label>
            <Input
              type="color"
              value={el.font_color ?? "#000000"}
              onChange={(e) => onCommit({ font_color: e.target.value })}
              className="h-7 p-1"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">폰트</Label>
            <Input
              value={el.font_family ?? "Helvetica"}
              onChange={(e) => onCommit({ font_family: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">정렬</Label>
            <Select
              value={el.text_align ?? "left"}
              onValueChange={(v) => onCommit({ text_align: v as any })}
            >
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">왼쪽</SelectItem>
                <SelectItem value="center">중앙</SelectItem>
                <SelectItem value="right">오른쪽</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

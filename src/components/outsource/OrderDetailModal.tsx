import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Copy,
  Download,
  AlertTriangle,
  X,
  RefreshCw,
  ImageOff,
  Code2,
  Loader2,
  FileDown,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CardFrame, CARD_W_MM, CARD_H_MM } from "./CardFrame";

export interface OrderDetailData {
  orderSerialNo: string;
  twinCodeSvg?: string | null;
  designPng?: string | null;
  cpValue?: string | null;
  sequenceNo?: string | null;
  twinCodePng?: string | null;
  dmBarcodePng?: string | null;
  edition?: string | null;
  mintedOn?: string | null;
  grade?: string | null;
  signPng?: string | null;
  cardFrontDesignPng?: string | null;
  cardBackDesignPng?: string | null;
  logoPng?: string | null;
}

type FieldKey = keyof OrderDetailData;

interface FieldSpec {
  key: FieldKey;
  label: string;
  factories: string[];
  required?: boolean;
  type: "text" | "image" | "svg";
  fileName?: string;
}

const FIELDS: FieldSpec[] = [
  { key: "orderSerialNo", label: "주문 일련번호", factories: ["실리콘", "열전사", "홀로그램"], required: true, type: "text" },
  { key: "twinCodeSvg", label: "트윈코드 SVG", factories: ["실리콘"], required: true, type: "svg", fileName: "트윈코드.svg" },
  { key: "designPng", label: "디자인 PNG", factories: ["열전사"], required: true, type: "image", fileName: "디자인.png" },
  { key: "cpValue", label: "CP 값", factories: ["NFC 앞", "NFC 뒤"], type: "text" },
  { key: "sequenceNo", label: "순번번호", factories: ["홀로그램", "NFC 앞"], type: "text" },
  { key: "twinCodePng", label: "트윈코드 PNG", factories: ["NFC 뒤"], type: "image", fileName: "트윈코드.png" },
  { key: "dmBarcodePng", label: "DM 바코드 PNG", factories: ["NFC 뒤"], type: "image", fileName: "DM바코드.png" },
  { key: "edition", label: "EDITION", factories: ["NFC 뒤"], type: "text" },
  { key: "mintedOn", label: "Minted on", factories: ["NFC 뒤"], type: "text" },
  { key: "grade", label: "등급", factories: ["NFC 뒤"], type: "text" },
  { key: "signPng", label: "싸인 PNG", factories: ["NFC 뒤"], type: "image", fileName: "싸인.png" },
  { key: "cardFrontDesignPng", label: "카드 앞면 디자인 PNG", factories: ["NFC 앞"], type: "image", fileName: "카드_앞면_디자인.png" },
  { key: "cardBackDesignPng", label: "카드 뒷면 디자인 PNG", factories: ["NFC 뒤"], type: "image", fileName: "카드_뒷면_디자인.png" },
  { key: "logoPng", label: "LOGO PNG", factories: ["LOGO"], required: true, type: "image", fileName: "LOGO.png" },
];

const TEXT_KEYS: FieldKey[] = ["orderSerialNo", "edition", "mintedOn", "grade", "cpValue", "sequenceNo"];
const CODE_IMAGE_KEYS: FieldKey[] = ["twinCodeSvg", "twinCodePng", "dmBarcodePng", "signPng"];
const DESIGN_IMAGE_KEYS: FieldKey[] = ["designPng", "cardFrontDesignPng", "cardBackDesignPng", "logoPng"];

function isHttps(url?: string | null): url is string {
  return !!url && /^https:\/\//i.test(url);
}

function copy(value: string) {
  navigator.clipboard.writeText(value);
  toast({ title: "복사되었습니다", description: value });
}

function FactoryTags({ factories }: { factories: string[] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {factories.map((f) => (
        <Badge key={f} variant="secondary" className="text-[10px] py-0 px-1.5">
          {f}
        </Badge>
      ))}
    </div>
  );
}

function MissingValue() {
  return <span className="text-muted-foreground italic">— (미수신)</span>;
}

async function downloadCardAsPdf(url: string, fileName: string) {
  try {
    const res = await fetch(url, { mode: "cors", referrerPolicy: "no-referrer" });
    const blob = await res.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const fmt = (blob.type.includes("png") || /\.png(\?|$)/i.test(url)) ? "PNG" : "JPEG";
    const doc = new jsPDF({ unit: "mm", format: [CARD_W_MM, CARD_H_MM], orientation: "portrait" });
    doc.addImage(dataUrl, fmt, 0, 0, CARD_W_MM, CARD_H_MM, undefined, "FAST");
    doc.save(fileName);
  } catch (e: any) {
    toast({ title: "PDF 생성 실패", description: e?.message, variant: "destructive" as any });
  }
}


function ThumbCard({
  spec,
  url,
  onPreview,
  onCheck,
  checked,
  actualSize,
  mmScale,
}: {
  spec: FieldSpec;
  url?: string | null;
  onPreview: (spec: FieldSpec, url: string) => void;
  onCheck: (key: FieldKey, v: boolean) => void;
  checked: boolean;
  actualSize?: boolean;
  mmScale?: number;
}) {
  const [errored, setErrored] = useState(false);
  const [bust, setBust] = useState(0);
  const valid = isHttps(url);
  const src = valid ? `${url}${bust ? `#r=${bust}` : ""}` : "";

  const isCard = spec.key === "cardFrontDesignPng" || spec.key === "cardBackDesignPng";
  const k = (mmScale ?? 100) / 100;
  const wrapperStyle: React.CSSProperties | undefined =
    isCard && actualSize ? { width: `calc(${CARD_W_MM}mm * ${k} + 2px)` } : undefined;
  const InnerFrame: React.ElementType = isCard ? CardFrame : "div";
  const innerProps: any = isCard
    ? { actualSize, mmScale, className: "flex items-center justify-center group" }
    : { className: "relative aspect-square bg-muted/40 flex items-center justify-center group" };
  return (
    <div className="rounded-lg border bg-card overflow-hidden flex flex-col" style={wrapperStyle}>
      <InnerFrame {...innerProps}>


        {valid && !errored ? (
          <img
            src={src}
            alt={spec.label}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain cursor-zoom-in"
            onClick={() => onPreview(spec, url!)}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="flex flex-col items-center text-xs text-muted-foreground gap-1 p-2 text-center">
            <ImageOff className="w-5 h-5" />
            {errored ? "이미지 로드 실패" : "— (미수신)"}
            {errored && (
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => { setErrored(false); setBust(Date.now()); }}>
                <RefreshCw className="w-3 h-3 mr-1" /> 재시도
              </Button>
            )}
          </div>
        )}
        {valid && !errored && (
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
            {isCard && (
              <Button
                size="icon"
                variant="secondary"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  const base = (spec.fileName || spec.key).replace(/\.[^.]+$/, "");
                  downloadCardAsPdf(url!, `${base}.pdf`);
                }}
                aria-label="PDF 다운로드"
                title="PDF 다운로드 (57×87mm)"
              >
                <FileDown className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                const a = document.createElement("a");
                a.href = url!;
                a.download = spec.fileName || `${spec.key}`;
                a.target = "_blank";
                a.rel = "noreferrer";
                a.click();
              }}
              aria-label="원본 다운로드"
            >
              <Download className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </InnerFrame>
      <div className="p-2 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs font-medium leading-tight">
            {spec.label}
            {spec.required && <span className="text-destructive ml-0.5">*</span>}
          </div>
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheck(spec.key, !!v)}
            aria-label="검수"
          />
        </div>
        <FactoryTags factories={spec.factories} />
        {isCard && valid && !errored && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full h-7 text-[11px] mt-1"
            onClick={(e) => {
              e.stopPropagation();
              const base = (spec.fileName || spec.key).replace(/\.[^.]+$/, "");
              downloadCardAsPdf(url!, `${base}.pdf`);
            }}
          >
            <FileDown className="w-3.5 h-3.5 mr-1" />
            PDF 다운로드 (57×87mm)
          </Button>
        )}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: OrderDetailData | null;
  /** Optional async loader to refetch latest URLs when modal opens */
  refetch?: (orderSerialNo: string) => Promise<OrderDetailData>;
}

export default function OrderDetailModal({ open, onOpenChange, data, refetch }: Props) {
  const [current, setCurrent] = useState<OrderDetailData | null>(data);
  const [loading, setLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; label: string; isCard?: boolean } | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [actualSize, setActualSize] = useState<boolean>(() => {
    try { return localStorage.getItem("orderDetail.actualSize") === "1"; } catch { return false; }
  });
  const [mmScale, setMmScale] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem("orderDetail.mmScale") || "100"); return isNaN(v) ? 100 : v; } catch { return 100; }
  });
  useEffect(() => { try { localStorage.setItem("orderDetail.actualSize", actualSize ? "1" : "0"); } catch {} }, [actualSize]);
  useEffect(() => { try { localStorage.setItem("orderDetail.mmScale", String(mmScale)); } catch {} }, [mmScale]);

  useEffect(() => {
    if (!open) return;
    setChecks({});
    setShowJson(false);
    setCurrent(data);
    if (refetch && data?.orderSerialNo) {
      setLoading(true);
      refetch(data.orderSerialNo)
        .then((fresh) => setCurrent(fresh))
        .catch(() => toast({ title: "최신 데이터 조회 실패", variant: "destructive" as any }))
        .finally(() => setLoading(false));
    }
    // audit log
    try {
      console.info("[audit] order.detail.view", {
        orderSerialNo: data?.orderSerialNo,
        at: new Date().toISOString(),
      });
    } catch {}
  }, [open, data, refetch]);

  const missingRequired = useMemo(() => {
    if (!current) return [];
    return FIELDS.filter((f) => f.required && !current[f.key]);
  }, [current]);

  const allChecked = useMemo(
    () => FIELDS.every((f) => checks[f.key]),
    [checks],
  );

  const handlePreview = (spec: FieldSpec, url: string) => {
    const isCard = spec.key === "cardFrontDesignPng" || spec.key === "cardBackDesignPng";
    setLightbox({ url, label: spec.label, isCard });
  };

  const handleCheck = (key: FieldKey, v: boolean) => {
    setChecks((p) => ({ ...p, [key]: v }));
  };

  const handleClose = () => {
    if (downloading) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  };

  const downloadZip = async () => {
    if (!current) return;
    setDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`주문상세_${current.orderSerialNo}`)!;
      const info: Record<string, any> = {
        주문일련번호: current.orderSerialNo,
        CP값: current.cpValue,
        순번번호: current.sequenceNo,
        EDITION: current.edition,
        MintedOn: current.mintedOn,
        등급: current.grade,
      };
      folder.file("info.json", JSON.stringify(info, null, 2));

      const fileFields = FIELDS.filter((f) => f.type !== "text" && f.fileName);
      await Promise.all(
        fileFields.map(async (f) => {
          const url = current[f.key] as string | null | undefined;
          if (!isHttps(url)) return;
          try {
            const res = await fetch(url, { referrerPolicy: "no-referrer" });
            if (!res.ok) throw new Error(`${res.status}`);
            const blob = await res.blob();
            folder.file(f.fileName!, blob);
          } catch (e) {
            folder.file(`${f.fileName}.error.txt`, `Failed to fetch: ${url}\n${e}`);
          }
        }),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `주문상세_${current.orderSerialNo}_${today}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      console.info("[audit] order.detail.download", { orderSerialNo: current.orderSerialNo, at: new Date().toISOString() });
      toast({ title: "ZIP 다운로드를 시작했습니다" });
    } catch (e: any) {
      toast({ title: "다운로드 실패", description: e?.message, variant: "destructive" as any });
    } finally {
      setDownloading(false);
    }
  };

  if (!data) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) handleClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent className="max-w-5xl p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              주문 상세 - <span className="font-mono">{data.orderSerialNo}</span>
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              {allChecked && <Badge className="ml-2">발주 가능</Badge>}
            </DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh]">
            <div className="p-5 space-y-5">
              {missingRequired.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    ⚠ 발주에 필요한 데이터가 누락되어 있습니다:{" "}
                    <strong>{missingRequired.map((f) => f.label).join(", ")}</strong>
                  </AlertDescription>
                </Alert>
              )}

              {/* 섹션 1. 기본 정보 */}
              <section>
                <h3 className="text-sm font-semibold mb-2">🔹 기본 정보</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {TEXT_KEYS.map((k) => {
                    const spec = FIELDS.find((f) => f.key === k)!;
                    const value = current?.[k] as string | undefined | null;
                    return (
                      <div key={k} className="rounded-md border p-3 bg-card">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-muted-foreground">
                              {spec.label}
                              {spec.required && <span className="text-destructive ml-0.5">*</span>}
                            </div>
                            <div className="text-sm font-medium mt-0.5 break-all flex items-center gap-2">
                              {value ? (
                                k === "grade" ? <Badge>{value}</Badge> : <span>{value}</span>
                              ) : (
                                <MissingValue />
                              )}
                              {value && (
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(value)}>
                                  <Copy className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                            <FactoryTags factories={spec.factories} />
                          </div>
                          <Checkbox
                            checked={!!checks[k]}
                            onCheckedChange={(v) => handleCheck(k, !!v)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 섹션 2. 코드/바코드 이미지 */}
              <section>
                <h3 className="text-sm font-semibold mb-2">🔹 코드/바코드 이미지</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {CODE_IMAGE_KEYS.map((k) => {
                    const spec = FIELDS.find((f) => f.key === k)!;
                    return (
                      <ThumbCard
                        key={k}
                        spec={spec}
                        url={current?.[k] as string | null | undefined}
                        onPreview={handlePreview}
                        onCheck={handleCheck}
                        checked={!!checks[k]}
                      />
                    );
                  })}
                </div>
              </section>

              {/* 섹션 3. 디자인 이미지 */}
              <section>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold">🔹 디자인 이미지</h3>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={actualSize} onCheckedChange={(v) => setActualSize(!!v)} />
                      <span>실제크기 (57×87mm)</span>
                    </label>
                    {actualSize && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">보정</span>
                        <input
                          type="range"
                          min={80}
                          max={120}
                          step={0.5}
                          value={mmScale}
                          onChange={(e) => setMmScale(parseFloat(e.target.value))}
                          className="w-32 accent-primary"
                        />
                        <input
                          type="number"
                          min={50}
                          max={150}
                          step={0.5}
                          value={mmScale}
                          onChange={(e) => setMmScale(parseFloat(e.target.value) || 100)}
                          className="w-16 h-7 px-1.5 rounded border bg-background text-right"
                        />
                        <span className="text-muted-foreground">%</span>
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setMmScale(100)}>
                          리셋
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {actualSize && (
                  <p className="text-[11px] text-muted-foreground mb-2">
                    💡 카드를 화면에 대고 실제 57mm×87mm가 되도록 보정값을 조정하세요. 설정은 브라우저에 저장됩니다.
                  </p>
                )}
                <div className={actualSize ? "flex flex-wrap gap-3" : "grid grid-cols-2 md:grid-cols-4 gap-3"}>
                  {DESIGN_IMAGE_KEYS.map((k) => {
                    const spec = FIELDS.find((f) => f.key === k)!;
                    return (
                      <ThumbCard
                        key={k}
                        spec={spec}
                        url={current?.[k] as string | null | undefined}
                        onPreview={handlePreview}
                        onCheck={handleCheck}
                        checked={!!checks[k]}
                        actualSize={actualSize}
                        mmScale={mmScale}
                      />
                    );
                  })}
                </div>
              </section>

              {showJson && (
                <section>
                  <h3 className="text-sm font-semibold mb-2">원본 API 응답</h3>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-72">
                    {JSON.stringify(current, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="p-4 border-t flex-row items-center justify-between gap-2 sm:justify-between">
            <Button variant="ghost" size="sm" onClick={() => setShowJson((s) => !s)}>
              <Code2 className="w-4 h-4 mr-1" />
              {showJson ? "JSON 숨기기" : "원본 API 응답(JSON) 보기"}
            </Button>
            <div className="flex gap-2">
              <Button onClick={downloadZip} disabled={downloading}>
                {downloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                모든 자원 일괄 다운로드 (ZIP)
              </Button>
              <Button variant="outline" onClick={handleClose}>닫기</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{lightbox?.label}</DialogTitle>
          </DialogHeader>
          {lightbox && (
            <div className="flex flex-col items-center gap-3">
              {lightbox.isCard ? (
                <CardFrame
                  actualSize={actualSize}
                  mmScale={mmScale}
                  widthClassName="w-auto"
                  className={actualSize ? "border" : "h-[70vh] border"}
                  style={!actualSize ? { aspectRatio: `${CARD_W_MM}/${CARD_H_MM}`, width: "auto" } : undefined}
                >
                  <img
                    src={lightbox.url}
                    alt={lightbox.label}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </CardFrame>
              ) : (
                <img
                  src={lightbox.url}
                  alt={lightbox.label}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] object-contain"
                />
              )}
              <a
                href={lightbox.url}
                download
                target="_blank"
                rel="noreferrer"
                className={cn("text-sm underline text-primary")}
              >
                원본 다운로드
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Close confirm during download */}
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>다운로드 작업 중입니다</AlertDialogTitle>
            <AlertDialogDescription>
              ZIP 다운로드가 진행 중입니다. 정말 닫으시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>계속 진행</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              닫기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

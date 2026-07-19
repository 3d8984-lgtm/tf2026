import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { useOrders } from "@/hooks/useDbData";
import { Search, ChevronLeft, Loader2, ImageIcon } from "lucide-react";

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return String(iso).slice(0, 10); }
}

function isUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\//i.test(v);
}
function isImageUrl(v: unknown): v is string {
  if (!isUrl(v)) return false;
  const path = v.split("?")[0].toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)
    || /\/(twincodes|images|logos|designs)\//.test(path)
    || /image|photo|logo|svg|png|jpg|design|twincode|sign|barcode/i.test(v);
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\burl\b/gi, "").trim();
}

function formatCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "object") { try { return JSON.stringify(value); } catch { return String(value); } }
  return String(value);
}

function ItemDetailBlock({ item, onImageClick }: { item: Record<string, any>; onImageClick: (url: string, label: string) => void }) {
  const entries = Object.entries(item);
  const imageEntries = entries.filter(([, v]) => isImageUrl(v));
  const linkEntries = entries.filter(([, v]) => isUrl(v) && !isImageUrl(v));
  const textEntries = entries.filter(([, v]) => !isUrl(v));

  return (
    <div className="space-y-4">
      {imageEntries.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">이미지</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {imageEntries.map(([k, v]) => (
              <button
                key={k}
                onClick={() => onImageClick(v as string, humanizeKey(k))}
                className="group border rounded-md overflow-hidden bg-muted/30 hover:border-primary transition-colors text-left"
              >
                <div className="aspect-square flex items-center justify-center bg-white overflow-hidden">
                  <img
                    src={v as string}
                    alt={k}
                    className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                    loading="lazy"
                    onError={(e) => {
                      const el = e.currentTarget;
                      el.style.display = "none";
                      const parent = el.parentElement;
                      if (parent) {
                        parent.innerHTML = '<div class="text-xs text-muted-foreground p-2 text-center">이미지 로드 실패</div>';
                      }
                    }}
                  />
                </div>
                <div className="px-2 py-1.5 text-xs truncate border-t bg-card">{humanizeKey(k)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {(textEntries.length > 0 || linkEntries.length > 0) && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">데이터</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {textEntries.map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-border/40 py-1">
                <span className="text-muted-foreground shrink-0 w-40 truncate">{humanizeKey(k)}</span>
                <span className="break-all">{formatCell(v)}</span>
              </div>
            ))}
            {linkEntries.map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-border/40 py-1">
                <span className="text-muted-foreground shrink-0 w-40 truncate">{humanizeKey(k)}</span>
                <a href={v as string} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">링크 열기</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AllOrders() {
  const { t } = useLang();
  const { data, isLoading } = useOrders();
  const [params, setParams] = useSearchParams();
  const orderId = params.get("orderId");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  const rows = useMemo(() => {
    return ((data || []) as any[]).map((o) => {
      const items: Record<string, any>[] = (o.source_data?.items as any) || [];
      const firstShipDate = items.find((i) => i?.ship_date)?.ship_date || null;
      return {
        id: o.id,
        orderNo: o.external_order_id,
        twinker: o.recipient_name || "—",
        createdAt: o.created_at,
        shipDate: firstShipDate || o.project_completed_at,
        quantity: o.quantity ?? items.length ?? 0,
        status: o.status || "received",
        raw: o,
        items,
      };
    });
  }, [data]);

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (r.orderNo || "").toLowerCase().includes(s) || (r.twinker || "").toLowerCase().includes(s);
  });

  const active = rows.find((r) => r.id === orderId) || null;

  // === Detail view ===
  if (active) {
    const o = active.raw;
    return (
      <div>
        <PageHeader title={`주문 데이터 전체보기 · ${active.orderNo}`} description={t("section.hq")} />
        <div className="p-6 space-y-4">
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
                <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
              </Button>
              <Badge variant="outline">{active.status}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-semibold">주문 기본 정보</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
                {[
                  ["작업지시번호", o.external_order_id],
                  ["트윈커명", o.recipient_name],
                  ["연락처", o.recipient_phone],
                  ["주문접수일", fmtDate(o.created_at)],
                  ["발송 예정일", fmtDate(active.shipDate)],
                  ["수량", active.quantity],
                  ["상품코드", o.product_code],
                  ["디자인코드", o.design_code],
                  ["배송지", [o.shipping_address, o.shipping_city, o.shipping_state, o.shipping_zip, o.shipping_country].filter(Boolean).join(", ")],
                ].map(([k, v]) => (
                  <div key={k as string} className="flex gap-2 border-b border-border/40 py-1">
                    <span className="text-muted-foreground shrink-0 w-28 truncate">{k}</span>
                    <span className="break-all">{formatCell(v)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {active.items.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">개별 항목 데이터가 없습니다.</CardContent>
            </Card>
          ) : (
            active.items.map((item, idx) => (
              <Card key={idx}>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <span>항목 #{idx + 1}</span>
                    {item.sequence_no && <span className="text-xs text-muted-foreground font-mono">{item.sequence_no}</span>}
                  </div>
                  <ItemDetailBlock item={item} onImageClick={(url, label) => setPreview({ url, label })} />
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> {preview?.label}
              </DialogTitle>
            </DialogHeader>
            {preview && (
              <div className="flex items-center justify-center bg-muted/30 rounded max-h-[75vh] overflow-auto">
                <img src={preview.url} alt={preview.label} className="max-w-full max-h-[75vh] object-contain" />
              </div>
            )}
            {preview && (
              <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                {preview.url}
              </a>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // === List view ===
  return (
    <div>
      <PageHeader title="주문 데이터 전체보기" description={t("section.hq")} />
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="작업지시번호 · 트윈커명" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
            </div>
            <div className="text-xs text-muted-foreground">총 {filtered.length}건</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>작업지시번호</TableHead>
                  <TableHead>트윈커명</TableHead>
                  <TableHead>주문접수일</TableHead>
                  <TableHead>발송 예정일</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="w-32 text-right">상세보기</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="w-4 h-4 animate-spin inline" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <button
                        className="font-mono text-primary hover:underline"
                        onClick={() => setParams({ orderId: r.id })}
                      >
                        {r.orderNo}
                      </button>
                    </TableCell>
                    <TableCell>{r.twinker}</TableCell>
                    <TableCell>{fmtDate(r.createdAt)}</TableCell>
                    <TableCell>{fmtDate(r.shipDate)}</TableCell>
                    <TableCell className="text-right">{r.quantity}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setParams({ orderId: r.id })}>
                        상세보기
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

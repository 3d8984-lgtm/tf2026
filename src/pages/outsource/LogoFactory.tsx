import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { sampleOrders, type FactoryOrder } from "@/components/outsource/FactoryOrderPanel";
import { useLang } from "@/contexts/LangContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Download, Eye, Trash2, ImageOff, FileText, Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface LogoGroup {
  orderNo: string;
  items: FactoryOrder[];
  totalQty: number;
  requestQty: number; // ceil(totalQty * 1.1)
  status: string;
  logoUrl: string | null;
  logoFileName: string;
}

// Sample logo URLs per work order (in production, fetch from orders.logo_url)
const SAMPLE_LOGOS: Record<string, string> = {
  "TM-2026-0001": "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600",
  "TM-2026-0002": "https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=600",
  "TM-2026-0003": "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=600",
};

export default function LogoFactory() {
  const { t } = useLang();
  const [orders, setOrders] = useState<FactoryOrder[]>(sampleOrders);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<LogoGroup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [generated, setGenerated] = useState(false);

  const groups: LogoGroup[] = useMemo(() => {
    const map = new Map<string, LogoGroup>();
    for (const o of orders) {
      const g = map.get(o.orderNo) || {
        orderNo: o.orderNo,
        items: [],
        totalQty: 0,
        requestQty: 0,
        status: o.status,
        logoUrl: SAMPLE_LOGOS[o.orderNo] ?? null,
        logoFileName: `${o.orderNo}_LOGO.png`,
      };
      g.items.push(o);
      g.totalQty += o.qty;
      g.requestQty = Math.ceil(g.totalQty * 1.1);
      map.set(o.orderNo, g);
    }
    return Array.from(map.values());
  }, [orders]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    setSelected(selected.size === groups.length ? new Set() : new Set(groups.map((g) => g.orderNo)));
  };

  const selectedGroups = groups.filter((g) => selected.has(g.orderNo));

  const downloadLogo = async (g: LogoGroup) => {
    if (!g.logoUrl) {
      toast({ title: "로고 이미지가 없습니다", variant: "destructive" as any });
      return;
    }
    try {
      const res = await fetch(g.logoUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = g.logoFileName;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: "로고 다운로드 시작", description: g.logoFileName });
    } catch (e: any) {
      // fallback: open in new tab
      const a = document.createElement("a");
      a.href = g.logoUrl;
      a.download = g.logoFileName;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.click();
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const ids = new Set(pendingDelete);
    setOrders((prev) => prev.filter((o) => !ids.has(o.orderNo)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    toast({ title: t("out.deleted"), description: `${pendingDelete.length}` });
    setPendingDelete(null);
  };

  return (
    <div>
      <PageHeader
        title={t("menu.outLogo")}
        description="작업번호별 1개의 로고 · 발주수량 = 작업건 주문수량 합계 × 1.1 (올림)"
      />
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("out.orderList")}</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={selected.size === 0}
                onClick={() => setPendingDelete(Array.from(selected))}
              >
                <Trash2 className="w-4 h-4 mr-1" /> {t("out.deleteSelected")}
              </Button>
              <Button
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  setGenerated(true);
                  toast({
                    title: t("out.generateOrderSheet"),
                    description: `${selectedGroups.length} 작업건 · 총 ${selectedGroups.reduce((s, g) => s + g.requestQty, 0)} EA`,
                  });
                }}
              >
                <FileText className="w-4 h-4 mr-1" /> {t("out.generateOrderSheet")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === groups.length && groups.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>작업번호</TableHead>
                  <TableHead>로고</TableHead>
                  <TableHead>주문 건수</TableHead>
                  <TableHead>주문수량</TableHead>
                  <TableHead>발주수량 (×1.1)</TableHead>
                  <TableHead>{t("out.status")}</TableHead>
                  <TableHead className="w-44 text-right">{t("out.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.orderNo}>
                    <TableCell>
                      <Checkbox checked={selected.has(g.orderNo)} onCheckedChange={() => toggle(g.orderNo)} />
                    </TableCell>
                    <TableCell className="font-mono">{g.orderNo}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => setPreview(g)}
                        className="w-14 h-14 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden hover:ring-2 hover:ring-primary transition"
                        aria-label="로고 미리보기"
                      >
                        {g.logoUrl ? (
                          <img
                            src={g.logoUrl}
                            alt={`${g.orderNo} 로고`}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <ImageOff className="w-5 h-5 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>{g.items.length}</TableCell>
                    <TableCell>{g.totalQty}</TableCell>
                    <TableCell>
                      <span className="font-semibold">{g.requestQty}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{g.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setPreview(g)}>
                        <Eye className="w-4 h-4 mr-1" /> 보기
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => downloadLogo(g)}
                        disabled={!g.logoUrl}
                        aria-label="로고 다운로드"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setPendingDelete([g.orderNo])}
                        aria-label={t("out.delete")}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                      —
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {generated && selectedGroups.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="w-4 h-4" /> {t("out.preview")}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toast({ title: t("out.sendEmail") })}>
                  <Mail className="w-4 h-4 mr-1" /> {t("out.sendEmail")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {selectedGroups.map((g) => (
                <div key={g.orderNo} className="flex items-center justify-between border rounded-md p-3 gap-3">
                  <div className="w-12 h-12 rounded border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                    {g.logoUrl ? (
                      <img src={g.logoUrl} alt="" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    ) : (
                      <ImageOff className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 font-mono text-sm">{g.orderNo}</div>
                  <div className="text-sm">
                    주문 {g.totalQty} → 발주 <span className="font-semibold">{g.requestQty}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadLogo(g)} disabled={!g.logoUrl}>
                    <Download className="w-4 h-4 mr-1" /> 로고
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Logo preview modal */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              로고 미리보기 — <span className="font-mono">{preview?.orderNo}</span>
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 flex items-center justify-center p-6 min-h-[320px]">
                {preview.logoUrl ? (
                  <img
                    src={preview.logoUrl}
                    alt={`${preview.orderNo} 로고`}
                    referrerPolicy="no-referrer"
                    className="max-h-[60vh] object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center text-muted-foreground gap-2">
                    <ImageOff className="w-10 h-10" />
                    <span className="text-sm">로고 이미지가 없습니다</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">주문 건수</div>
                  <div className="font-semibold">{preview.items.length}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">총 주문수량</div>
                  <div className="font-semibold">{preview.totalQty}</div>
                </div>
                <div className="rounded border p-3">
                  <div className="text-xs text-muted-foreground">발주수량 (×1.1)</div>
                  <div className="font-semibold text-primary">{preview.requestQty}</div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => downloadLogo(preview)} disabled={!preview.logoUrl}>
                  <Download className="w-4 h-4 mr-1" /> 로고 다운로드
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("out.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("out.deleteConfirmDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("out.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{t("out.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

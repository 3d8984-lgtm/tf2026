import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import { useLang } from "@/contexts/LangContext";
import { Mail, Download, FileText, Eye, Trash2, ChevronLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface FactoryOrder {
  orderNo: string;   // 작업번호 (group key)
  serial: string;    // 주문일련번호 (item)
  qty: number;
  status: string;
}

interface Props {
  generateLabelKey: string;
  downloadLabelKey?: string;
  extraColumns?: { header: string; render: (o: FactoryOrder) => React.ReactNode }[];
  orders: FactoryOrder[];
  renderPreview?: (selected: FactoryOrder[]) => React.ReactNode;
}

interface Group {
  orderNo: string;
  items: FactoryOrder[];
  totalQty: number;
  status: string;
}

export default function FactoryOrderPanel({
  generateLabelKey,
  downloadLabelKey = "out.download",
  extraColumns = [],
  orders: initialOrders,
  renderPreview,
}: Props) {
  const { t } = useLang();
  const [orders, setOrders] = useState<FactoryOrder[]>(initialOrders);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // item serials
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { type: "items"; serials: string[] }
    | { type: "groups"; orderNos: string[] }
    | null
  >(null);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const o of orders) {
      const g = map.get(o.orderNo) || { orderNo: o.orderNo, items: [], totalQty: 0, status: o.status };
      g.items.push(o);
      g.totalQty += o.qty;
      map.set(o.orderNo, g);
    }
    return Array.from(map.values());
  }, [orders]);

  const currentGroup = groups.find(g => g.orderNo === activeGroup) || null;
  const itemsInView = currentGroup?.items ?? [];

  const toggleItem = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const toggleAllItems = () => {
    setSelected(selected.size === itemsInView.length ? new Set() : new Set(itemsInView.map(o => o.serial)));
  };

  const toggleGroup = (id: string) => {
    const next = new Set(selectedGroups);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedGroups(next);
  };
  const toggleAllGroups = () => {
    setSelectedGroups(selectedGroups.size === groups.length ? new Set() : new Set(groups.map(g => g.orderNo)));
  };

  const selectedOrders = itemsInView.filter(o => selected.has(o.serial));

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.type === "items") {
      const ids = new Set(pendingDelete.serials);
      setOrders(prev => prev.filter(o => !ids.has(o.serial)));
      setSelected(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      toast({ title: t("out.deleted"), description: `${pendingDelete.serials.length}` });
    } else {
      const ids = new Set(pendingDelete.orderNos);
      setOrders(prev => prev.filter(o => !ids.has(o.orderNo)));
      setSelectedGroups(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      if (activeGroup && ids.has(activeGroup)) setActiveGroup(null);
      toast({ title: t("out.deleted"), description: `${pendingDelete.orderNos.length}` });
    }
    setPendingDelete(null);
  };

  // ===== Detail view (items inside a 작업번호) =====
  if (currentGroup) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setActiveGroup(null); setSelected(new Set()); setGenerated(false); }}>
                <ChevronLeft className="w-4 h-4 mr-1" /> 목록으로
              </Button>
              <CardTitle className="text-base">
                작업번호 <span className="font-mono">{currentGroup.orderNo}</span> · {currentGroup.items.length}건
              </CardTitle>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={selected.size === 0}
                onClick={() => setPendingDelete({ type: "items", serials: Array.from(selected) })}
              >
                <Trash2 className="w-4 h-4 mr-1" /> {t("out.deleteSelected")}
              </Button>
              <Button
                size="sm"
                disabled={selected.size === 0}
                onClick={() => {
                  setGenerated(true);
                  toast({ title: t(generateLabelKey), description: `${selected.size}` });
                }}
              >
                <FileText className="w-4 h-4 mr-1" /> {t(generateLabelKey)}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selected.size === itemsInView.length && itemsInView.length > 0} onCheckedChange={toggleAllItems} />
                  </TableHead>
                  <TableHead>{t("out.serial")}</TableHead>
                  <TableHead>{t("out.qty")}</TableHead>
                  {extraColumns.map((c, i) => <TableHead key={i}>{c.header}</TableHead>)}
                  <TableHead>{t("out.status")}</TableHead>
                  <TableHead className="w-16 text-right">{t("out.action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsInView.map(o => (
                  <TableRow key={o.serial}>
                    <TableCell><Checkbox checked={selected.has(o.serial)} onCheckedChange={() => toggleItem(o.serial)} /></TableCell>
                    <TableCell className="font-mono">{o.serial}</TableCell>
                    <TableCell>{o.qty}</TableCell>
                    {extraColumns.map((c, i) => <TableCell key={i}>{c.render(o)}</TableCell>)}
                    <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setPendingDelete({ type: "items", serials: [o.serial] })}
                        aria-label={t("out.delete")}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {itemsInView.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5 + extraColumns.length} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {generated && selectedOrders.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Eye className="w-4 h-4" /> {t("out.preview")}</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => toast({ title: t("out.sendEmail") })}>
                  <Mail className="w-4 h-4 mr-1" /> {t("out.sendEmail")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => toast({ title: t(downloadLabelKey) })}>
                  <Download className="w-4 h-4 mr-1" /> {t(downloadLabelKey)}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {renderPreview ? renderPreview(selectedOrders) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  {selectedOrders.length} · {t("out.preview")}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <DeleteDialog pendingDelete={pendingDelete} setPendingDelete={setPendingDelete} confirmDelete={confirmDelete} t={t} />
      </div>
    );
  }

  // ===== List view (grouped by 작업번호) =====
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("out.orderList")}</CardTitle>
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedGroups.size === 0}
            onClick={() => setPendingDelete({ type: "groups", orderNos: Array.from(selectedGroups) })}
          >
            <Trash2 className="w-4 h-4 mr-1" /> {t("out.deleteSelected")}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selectedGroups.size === groups.length && groups.length > 0} onCheckedChange={toggleAllGroups} />
                </TableHead>
                <TableHead>작업번호</TableHead>
                <TableHead>주문 건수</TableHead>
                <TableHead>{t("out.qty")}</TableHead>
                <TableHead>{t("out.status")}</TableHead>
                <TableHead className="w-32 text-right">{t("out.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(g => (
                <TableRow key={g.orderNo}>
                  <TableCell>
                    <Checkbox checked={selectedGroups.has(g.orderNo)} onCheckedChange={() => toggleGroup(g.orderNo)} />
                  </TableCell>
                  <TableCell>
                    <button className="font-mono text-primary hover:underline" onClick={() => setActiveGroup(g.orderNo)}>
                      {g.orderNo}
                    </button>
                  </TableCell>
                  <TableCell>{g.items.length}</TableCell>
                  <TableCell>{g.totalQty}</TableCell>
                  <TableCell><Badge variant="outline">{g.status}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setActiveGroup(g.orderNo)}>주문 보기</Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPendingDelete({ type: "groups", orderNos: [g.orderNo] })}
                      aria-label={t("out.delete")}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DeleteDialog pendingDelete={pendingDelete} setPendingDelete={setPendingDelete} confirmDelete={confirmDelete} t={t} />
    </div>
  );
}

function DeleteDialog({
  pendingDelete, setPendingDelete, confirmDelete, t,
}: {
  pendingDelete: any;
  setPendingDelete: (v: any) => void;
  confirmDelete: () => void;
  t: (k: string) => string;
}) {
  return (
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
  );
}


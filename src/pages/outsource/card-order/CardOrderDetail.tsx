import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader2, FileDown, Play } from "lucide-react";

interface Order {
  id: string;
  template_id: string;
  order_name: string;
  status: string;
  created_at: string;
  card_template?: { name: string };
}

interface Item {
  id: string;
  order_id: string;
  data: Record<string, any>;
  pdf_url: string | null;
  created_at: string;
}

export default function CardOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [oRes, iRes] = await Promise.all([
      supabase.from("card_order").select("*, card_template(name)").eq("id", id).single(),
      supabase.from("card_order_item").select("*").eq("order_id", id).order("created_at"),
    ]);
    if (oRes.error) toast.error(oRes.error.message);
    if (iRes.error) toast.error(iRes.error.message);
    setOrder(oRes.data as any);
    setItems((iRes.data ?? []) as Item[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const generateOne = async (item: Item) => {
    if (!order) return;
    setBusy(item.id);
    try {
      const res = await supabase.functions.invoke("generate-card-pdf", {
        body: { template_id: order.template_id, data: item.data, item_id: item.id },
      });
      if (res.error) throw res.error;
      const url = (res.data as any)?.pdf_url;
      if (!url) throw new Error("생성 실패");
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, pdf_url: url } : x)));
      toast.success("PDF 생성됨");
    } catch (e: any) {
      toast.error(e?.message ?? "생성 실패");
    } finally { setBusy(null); }
  };

  const generateAll = async () => {
    if (!order) return;
    setBulk(true);
    let ok = 0, fail = 0;
    for (const it of items) {
      try {
        const res = await supabase.functions.invoke("generate-card-pdf", {
          body: { template_id: order.template_id, data: it.data, item_id: it.id },
        });
        if (res.error) throw res.error;
        const url = (res.data as any)?.pdf_url;
        setItems((p) => p.map((x) => (x.id === it.id ? { ...x, pdf_url: url } : x)));
        ok++;
      } catch (e) {
        console.error(e); fail++;
      }
    }
    if (fail === 0) {
      await supabase.from("card_order").update({ status: "completed" }).eq("id", order.id);
      setOrder({ ...order, status: "completed" });
    }
    setBulk(false);
    if (fail === 0) toast.success(`완료: ${ok}장`);
    else toast.error(`완료: ${ok}장, 실패: ${fail}장`);
  };

  if (loading || !order) {
    return (
      <div className="p-10 flex items-center text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 불러오는 중...
      </div>
    );
  }

  const fields = items[0] ? Object.keys(items[0].data) : [];

  return (
    <div>
      <PageHeader
        title={order.order_name}
        description={`템플릿: ${(order as any).card_template?.name ?? "-"} · ${items.length}장`}
      >
        <Link to="/outsource/card-order/orders">
          <Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> 목록</Button>
        </Link>
        <Button size="sm" onClick={generateAll} disabled={bulk || items.length === 0}>
          {bulk ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
          전체 PDF 생성
        </Button>
      </PageHeader>

      <div className="p-6">
        <div className="mb-3 text-sm text-muted-foreground">
          상태: <Badge variant="outline">{order.status}</Badge>
        </div>
        {items.length === 0 ? (
          <div className="border rounded-lg p-12 text-center text-muted-foreground">카드 데이터가 없습니다.</div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  {fields.map((f) => (<TableHead key={f} className="text-xs">{f}</TableHead>))}
                  <TableHead>PDF</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    {fields.map((f) => {
                      const v = it.data[f];
                      const isUrl = typeof v === "string" && /^https?:\/\//.test(v);
                      return (
                        <TableCell key={f} className="text-xs max-w-[160px] truncate">
                          {isUrl ? (
                            <a href={v} target="_blank" rel="noreferrer" className="text-primary underline">link</a>
                          ) : String(v ?? "")}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {it.pdf_url ? (
                        <a href={it.pdf_url} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline"><FileDown className="w-3.5 h-3.5 mr-1" /> 열기</Button>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">미생성</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => generateOne(it)} disabled={busy === it.id}>
                        {busy === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "생성"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

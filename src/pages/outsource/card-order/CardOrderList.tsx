import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Loader2, Globe, Copy } from "lucide-react";

interface Order {
  id: string;
  template_id: string;
  order_name: string;
  status: string;
  created_at: string;
  template?: { name: string };
  items?: { count: number }[];
}

interface Template { id: string; name: string; }

const PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const INGEST_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/card-orders-ingest`;

export default function CardOrderList() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);

  const [templateId, setTemplateId] = useState("");
  const [orderName, setOrderName] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [csvRows, setCsvRows] = useState<Record<string, any>[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [oRes, tRes] = await Promise.all([
      supabase
        .from("card_order")
        .select("*, template:card_template(name), items:card_order_item(count)")
        .order("created_at", { ascending: false }),
      supabase.from("card_template").select("id, name").order("name"),
    ]);
    if (oRes.error) toast.error(oRes.error.message);
    if (tRes.error) toast.error(tRes.error.message);
    setOrders((oRes.data ?? []) as any);
    setTemplates((tRes.data ?? []) as Template[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const reset = () => {
    setTemplateId(""); setOrderName(""); setJsonText(""); setCsvRows(null);
  };

  const onCsv = (file: File) => {
    Papa.parse<Record<string, any>>(file, {
      header: true, skipEmptyLines: true,
      complete: (r) => setCsvRows(r.data),
      error: (e) => toast.error(e.message),
    });
  };

  const handleCreate = async () => {
    if (!templateId || !orderName.trim()) { toast.error("템플릿과 주문명을 입력하세요."); return; }
    let items: Record<string, any>[] = [];
    if (jsonText.trim()) {
      try {
        const parsed = JSON.parse(jsonText);
        items = Array.isArray(parsed) ? parsed : [parsed];
      } catch { toast.error("JSON 파싱 실패"); return; }
    } else if (csvRows && csvRows.length) {
      items = csvRows;
    } else {
      toast.error("카드 데이터를 입력하세요 (JSON 또는 CSV)"); return;
    }
    setSaving(true);
    try {
      const { data: order, error: oErr } = await supabase
        .from("card_order")
        .insert({ template_id: templateId, order_name: orderName.trim(), status: "ready" })
        .select().single();
      if (oErr) throw oErr;
      const rows = items.map((d) => ({ order_id: order.id, data: d }));
      const { error: iErr } = await supabase.from("card_order_item").insert(rows);
      if (iErr) throw iErr;
      toast.success(`주문 생성됨 (${rows.length}장)`);
      setOpen(false); reset(); await load();
    } catch (e: any) {
      toast.error(e?.message ?? "생성 실패");
    } finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader title="카드 주문 목록" description="템플릿 기반 카드 발주 주문">
        <Button variant="outline" size="sm" onClick={() => setApiOpen(true)}>
          <Globe className="w-4 h-4 mr-1" /> API 엔드포인트
        </Button>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> 새 주문 만들기</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>새 주문 만들기</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>템플릿 *</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                    <SelectTrigger><SelectValue placeholder="선택" /></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>주문명 *</Label>
                  <Input value={orderName} onChange={(e) => setOrderName(e.target.value)} />
                </div>
              </div>
              <Tabs defaultValue="json">
                <TabsList>
                  <TabsTrigger value="json">JSON 붙여넣기</TabsTrigger>
                  <TabsTrigger value="csv">CSV 업로드</TabsTrigger>
                  <TabsTrigger value="api">API 안내</TabsTrigger>
                </TabsList>
                <TabsContent value="json" className="space-y-1">
                  <Label className="text-xs">카드 배열 또는 단일 객체</Label>
                  <Textarea
                    rows={8}
                    className="font-mono text-xs"
                    placeholder={`[\n  { "cp_value": "CP 230", "serial": "#014/1000/R1", "character_image": "https://..." }\n]`}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                  />
                </TabsContent>
                <TabsContent value="csv" className="space-y-1">
                  <Label className="text-xs">CSV (헤더 = field_name)</Label>
                  <Input
                    type="file" accept=".csv,text/csv"
                    onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])}
                  />
                  {csvRows && (
                    <p className="text-xs text-muted-foreground">{csvRows.length}행 읽음</p>
                  )}
                </TabsContent>
                <TabsContent value="api" className="space-y-2">
                  <p className="text-xs text-muted-foreground">외부 시스템에서 다음 엔드포인트로 POST 요청</p>
                  <code className="block p-2 bg-muted rounded text-xs break-all">{`POST ${INGEST_URL}`}</code>
                  <code className="block p-2 bg-muted rounded text-xs whitespace-pre-wrap">{`{
  "template_id": "...",
  "order_name": "ORDER-001",
  "items": [{ "cp_value": "CP 230", ... }]
}`}</code>
                </TabsContent>
              </Tabs>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>취소</Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} 저장
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" /> 불러오는 중...</div>
        ) : orders.length === 0 ? (
          <div className="border rounded-lg p-12 text-center text-muted-foreground">아직 주문이 없습니다.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>주문명</TableHead>
                <TableHead>템플릿</TableHead>
                <TableHead>카드 수량</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>생성일</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.order_name}</TableCell>
                  <TableCell>{o.template?.name ?? "-"}</TableCell>
                  <TableCell>{o.items?.[0]?.count ?? 0}</TableCell>
                  <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString("ko-KR")}
                  </TableCell>
                  <TableCell>
                    <Link to={`/outsource/card-order/orders/${o.id}`}>
                      <Button size="sm" variant="outline">상세</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={apiOpen} onOpenChange={setApiOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>API 주문 수신 내역</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>아래 엔드포인트로 외부 시스템에서 주문을 전송할 수 있습니다.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-muted rounded text-xs break-all">{INGEST_URL}</code>
              <Button size="sm" variant="outline" onClick={() => {
                navigator.clipboard.writeText(INGEST_URL);
                toast.success("복사됨");
              }}><Copy className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

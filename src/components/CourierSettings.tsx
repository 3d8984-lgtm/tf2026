import { useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Plus, Pencil, Trash2, TestTube, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface CourierConfig {
  id: string;
  name: string;
  code: string;
  apiUrl: string;
  apiKey: string;
  enabled: boolean;
  testStatus: "idle" | "testing" | "success" | "fail";
}

const defaultCouriers: CourierConfig[] = [
  { id: "1", name: "4PX", code: "4px", apiUrl: "https://api.4px.com", apiKey: "", enabled: false, testStatus: "idle" },
  { id: "2", name: "YunExpress", code: "yunexpress", apiUrl: "https://api.yunexpress.com", apiKey: "", enabled: false, testStatus: "idle" },
];

export default function CourierSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();
  const [couriers, setCouriers] = useState<CourierConfig[]>(defaultCouriers);
  const [editDialog, setEditDialog] = useState(false);
  const [editingCourier, setEditingCourier] = useState<CourierConfig | null>(null);
  const [form, setForm] = useState({ name: "", code: "", apiUrl: "", apiKey: "" });

  const openAdd = () => {
    setEditingCourier(null);
    setForm({ name: "", code: "", apiUrl: "", apiKey: "" });
    setEditDialog(true);
  };

  const openEdit = (c: CourierConfig) => {
    setEditingCourier(c);
    setForm({ name: c.name, code: c.code, apiUrl: c.apiUrl, apiKey: c.apiKey });
    setEditDialog(true);
  };

  const handleSave = () => {
    if (!form.name || !form.code) return;
    if (editingCourier) {
      setCouriers(prev => prev.map(c => c.id === editingCourier.id ? { ...c, ...form } : c));
    } else {
      setCouriers(prev => [...prev, { id: crypto.randomUUID(), ...form, enabled: false, testStatus: "idle" }]);
    }
    setEditDialog(false);
    toast({ title: isKo ? "저장됨" : "已保存" });
  };

  const handleDelete = (id: string) => {
    setCouriers(prev => prev.filter(c => c.id !== id));
  };

  const toggleEnabled = (id: string) => {
    setCouriers(prev => prev.map(c => c.id === id ? { ...c, enabled: !c.enabled } : c));
  };

  const handleTest = (id: string) => {
    setCouriers(prev => prev.map(c => c.id === id ? { ...c, testStatus: "testing" } : c));
    setTimeout(() => {
      setCouriers(prev => prev.map(c => c.id === id ? { ...c, testStatus: c.apiKey ? "success" : "fail" } : c));
    }, 1500);
  };

  return (
    <div className="section-enter space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            {isKo ? "택배사 연동 설정" : "快递公司对接设置"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {isKo ? "택배사 API를 등록하고 연동 상태를 관리합니다. 택배사가 확정되면 API Key를 입력해주세요." : "注册快递公司API并管理对接状态。确定快递公司后请输入API Key。"}
          </p>
        </div>
        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="w-4 h-4" />{isKo ? "택배사 추가" : "添加快递公司"}</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCourier ? (isKo ? "택배사 수정" : "修改快递公司") : (isKo ? "택배사 추가" : "添加快递公司")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>{isKo ? "택배사명" : "快递公司名称"}</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="예: 4PX, UPS, FedEx" />
              </div>
              <div className="space-y-2">
                <Label>{isKo ? "코드" : "代码"}</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="예: 4px, ups" />
              </div>
              <div className="space-y-2">
                <Label>API URL</Label>
                <Input value={form.apiUrl} onChange={e => setForm(f => ({ ...f, apiUrl: e.target.value }))} placeholder="https://api.example.com" />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} placeholder={isKo ? "택배사에서 발급받은 API Key" : "快递公司提供的API Key"} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditDialog(false)}>{isKo ? "취소" : "取消"}</Button>
                <Button onClick={handleSave}>{isKo ? "저장" : "保存"}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{isKo ? "택배사" : "快递公司"}</TableHead>
              <TableHead>{isKo ? "코드" : "代码"}</TableHead>
              <TableHead>API URL</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>{isKo ? "활성화" : "启用"}</TableHead>
              <TableHead>{isKo ? "연동 테스트" : "对接测试"}</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {couriers.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell><Badge variant="outline">{c.code}</Badge></TableCell>
                <TableCell className="font-mono text-xs max-w-[200px] truncate">{c.apiUrl || "-"}</TableCell>
                <TableCell className="text-xs">{c.apiKey ? "••••••••" : <span className="text-muted-foreground italic">{isKo ? "미설정" : "未设置"}</span>}</TableCell>
                <TableCell>
                  <Switch checked={c.enabled} onCheckedChange={() => toggleEnabled(c.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => handleTest(c.id)} disabled={c.testStatus === "testing"}>
                      {c.testStatus === "testing" ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
                      {isKo ? "테스트" : "测试"}
                    </Button>
                    {c.testStatus === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {c.testStatus === "fail" && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {couriers.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isKo ? "등록된 택배사가 없습니다" : "暂无注册的快递公司"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Feature description */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <h4 className="text-sm font-medium">{isKo ? "택배사 연동 시 지원 기능" : "快递公司对接支持功能"}</h4>
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { title: isKo ? "송장 자동 발급" : "自动生成运单", desc: isKo ? "주문 정보를 택배사 API로 전송하여 운송장번호를 자동 발급받습니다" : "将订单信息发送至快递公司API自动获取运单号" },
            { title: isKo ? "라벨 PDF 다운로드" : "标签PDF下载", desc: isKo ? "택배사에서 반환된 배송 라벨을 PDF로 다운로드하여 출력합니다" : "下载快递公司返回的配送标签PDF并打印" },
            { title: isKo ? "배송 추적 조회" : "物流追踪查询", desc: isKo ? "운송장번호로 실시간 배송 상태를 조회합니다" : "通过运单号实时查询配送状态" },
          ].map(f => (
            <div key={f.title} className="p-3 rounded-md border bg-background">
              <p className="text-sm font-medium">{f.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

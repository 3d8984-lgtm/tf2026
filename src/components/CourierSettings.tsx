import { useEffect, useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Plus, Pencil, Trash2, TestTube, CheckCircle2, XCircle, Loader2, KeyRound } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useCouriers,
  useSaveCourier,
  useDeleteCourier,
  useSaveCourierCredentials,
  useClearCourierCredentials,
  useTestCourier,
  useCourierExtra,
  type CourierConfigRow,
} from "@/hooks/useCouriers";

const emptyForm = { code: "", name: "", api_url: "", api_mode: "test", enabled: false, is_default: false, sort_order: 0 };
const emptyCred = {
  api_key: "",
  api_secret: "",
  account_no: "",
  channel_code: "",
  // 발송인 정보
  sender_name: "",
  sender_company: "",
  sender_phone: "",
  sender_country: "",
  sender_state: "",
  sender_city: "",
  sender_street: "",
  sender_post_code: "",
  // 신고 정보
  hscode: "",
  unit_price: "",
  item_name_en: "",
  item_name_cn: "",
  brand: "",
};

export default function CourierSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();

  const { data: couriers = [], isLoading } = useCouriers();
  const saveCourier = useSaveCourier();
  const deleteCourier = useDeleteCourier();
  const saveCreds = useSaveCourierCredentials();
  const clearCreds = useClearCourierCredentials();
  const testCourier = useTestCourier();

  const [editDialog, setEditDialog] = useState(false);
  const [editing, setEditing] = useState<CourierConfigRow | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [credDialog, setCredDialog] = useState<CourierConfigRow | null>(null);
  const [cred, setCred] = useState({ ...emptyCred });
  const [testingCode, setTestingCode] = useState<string | null>(null);

  const tr = (ko: string, zh: string) => (isKo ? ko : zh);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setEditDialog(true); };
  const openEdit = (c: CourierConfigRow) => {
    setEditing(c);
    setForm({ code: c.code, name: c.name, api_url: c.api_url, api_mode: c.api_mode, enabled: c.enabled, is_default: c.is_default, sort_order: c.sort_order });
    setEditDialog(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.code) return;
    try {
      await saveCourier.mutateAsync({ ...form, id: editing?.id });
      setEditDialog(false);
      toast({ title: tr("저장되었습니다", "已保存") });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("저장 실패", "保存失败"), description: e.message });
    }
  };

  const handleDelete = async (c: CourierConfigRow) => {
    try {
      await deleteCourier.mutateAsync(c.id);
      toast({ title: tr("삭제되었습니다", "已删除") });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("삭제 실패", "删除失败"), description: e.message });
    }
  };

  const toggleEnabled = async (c: CourierConfigRow) => {
    try {
      await saveCourier.mutateAsync({ ...c, enabled: !c.enabled });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("변경 실패", "更新失败"), description: e.message });
    }
  };

  const openCred = (c: CourierConfigRow) => { setCred({ ...emptyCred }); setCredDialog(c); };

  const { data: credExtra } = useCourierExtra(credDialog?.code ?? null);
  useEffect(() => {
    if (!credDialog || !credExtra) return;
    const e = (credExtra.extra ?? {}) as Record<string, unknown>;
    const s = (k: string) => (e[k] === undefined || e[k] === null ? "" : String(e[k]));
    setCred((prev) => ({
      ...prev,
      account_no: credExtra.account_no ?? "",
      channel_code: s("channel_code") || s("logistics_product_code"),
      sender_name: s("sender_name"),
      sender_company: s("sender_company"),
      sender_phone: s("sender_phone"),
      sender_country: s("sender_country"),
      sender_state: s("sender_state"),
      sender_city: s("sender_city"),
      sender_street: s("sender_street"),
      sender_post_code: s("sender_post_code"),
      hscode: s("hscode"),
      unit_price: s("unit_price"),
      item_name_en: s("item_name_en"),
      item_name_cn: s("item_name_cn"),
      brand: s("brand"),
    }));
  }, [credDialog?.code, credExtra]);

  const handleSaveCred = async () => {
    if (!credDialog) return;
    try {
      const base = (credExtra?.extra ?? {}) as Record<string, unknown>;
      const extra: Record<string, unknown> = { ...base };
      const put = (key: string, val: string) => {
        const v = val.trim();
        if (v) extra[key] = v;
        else delete extra[key];
      };
      put("channel_code", cred.channel_code);
      put("sender_name", cred.sender_name);
      put("sender_company", cred.sender_company);
      put("sender_phone", cred.sender_phone);
      put("sender_country", cred.sender_country);
      put("sender_state", cred.sender_state);
      put("sender_city", cred.sender_city);
      put("sender_street", cred.sender_street);
      put("sender_post_code", cred.sender_post_code);
      put("hscode", cred.hscode);
      put("item_name_en", cred.item_name_en);
      put("item_name_cn", cred.item_name_cn);
      put("brand", cred.brand);
      if (cred.unit_price.trim() && !Number.isNaN(Number(cred.unit_price))) extra.unit_price = Number(cred.unit_price);
      else delete extra.unit_price;

      await saveCreds.mutateAsync({
        code: credDialog.code,
        api_key: cred.api_key,
        api_secret: cred.api_secret,
        account_no: cred.account_no,
        extra,
      });
      setCredDialog(null);
      toast({ title: tr("인증정보가 안전하게 저장되었습니다", "认证信息已安全保存") });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("저장 실패", "保存失败"), description: e.message });
    }
  };

  const handleTest = async (c: CourierConfigRow) => {
    setTestingCode(c.code);
    try {
      const res = await testCourier.mutateAsync(c.code);
      toast({
        variant: res.ok ? "default" : "destructive",
        title: res.ok ? tr("연결 성공", "连接成功") : tr("연결 실패", "连接失败"),
        description: res.message,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: tr("테스트 실패", "测试失败"), description: e.message });
    } finally {
      setTestingCode(null);
    }
  };

  return (
    <div className="section-enter space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary" />
            {tr("택배사 연동 설정", "快递公司对接设置")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {tr(
              "등록된 택배사는 배송 관리에서 선택할 수 있으며, 선택한 택배사의 API로 송장번호가 자동 발급됩니다.",
              "已注册的快递公司可在配送管理中选择，系统会调用该公司API自动生成运单号。"
            )}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="w-4 h-4" />{tr("택배사 추가", "添加快递公司")}
        </Button>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("택배사", "快递公司")}</TableHead>
              <TableHead>{tr("코드", "代码")}</TableHead>
              <TableHead>API URL</TableHead>
              <TableHead>{tr("모드", "模式")}</TableHead>
              <TableHead>{tr("인증정보", "认证信息")}</TableHead>
              <TableHead>{tr("활성화", "启用")}</TableHead>
              <TableHead>{tr("연동 테스트", "对接测试")}</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {couriers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.name}
                  {c.is_default && <Badge variant="secondary" className="ml-2 text-[10px]">{tr("기본", "默认")}</Badge>}
                </TableCell>
                <TableCell><Badge variant="outline">{c.code}</Badge></TableCell>
                <TableCell className="font-mono text-xs max-w-[220px] truncate">{c.api_url || "-"}</TableCell>
                <TableCell>
                  <Badge variant={c.api_mode === "live" ? "default" : "outline"} className="text-[10px]">
                    {c.api_mode === "live" ? tr("실서비스", "正式") : tr("테스트", "测试")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openCred(c)}>
                    <KeyRound className="w-3 h-3" />
                    {c.has_credentials ? tr("설정됨", "已设置") : tr("미설정", "未设置")}
                  </Button>
                </TableCell>
                <TableCell><Switch checked={c.enabled} onCheckedChange={() => toggleEnabled(c)} /></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => handleTest(c)} disabled={testingCode === c.code}>
                      {testingCode === c.code ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
                      {tr("테스트", "测试")}
                    </Button>
                    {c.last_test_ok === true && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {c.last_test_ok === false && <XCircle className="w-4 h-4 text-destructive" />}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && couriers.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {tr("등록된 택배사가 없습니다", "暂无注册的快递公司")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Courier dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? tr("택배사 수정", "修改快递公司") : tr("택배사 추가", "添加快递公司")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>{tr("택배사명", "快递公司名称")}</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="4PX / YunExpress" />
            </div>
            <div className="space-y-2">
              <Label>{tr("코드", "代码")}</Label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.trim().toLowerCase() }))} placeholder="4px / yunexpress" disabled={!!editing} />
            </div>
            <div className="space-y-2">
              <Label>API URL</Label>
              <Input value={form.api_url} onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))} placeholder="https://api.example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{tr("모드", "模式")}</Label>
                <Select value={form.api_mode} onValueChange={(v) => setForm((f) => ({ ...f, api_mode: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">{tr("테스트", "测试")}</SelectItem>
                    <SelectItem value="live">{tr("실서비스", "正式")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tr("정렬 순서", "排序")}</Label>
                <Input type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label className="text-sm">{tr("기본 택배사로 사용", "设为默认快递")}</Label>
              <Switch checked={form.is_default} onCheckedChange={(v) => setForm((f) => ({ ...f, is_default: v }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditDialog(false)}>{tr("취소", "取消")}</Button>
              <Button onClick={handleSave} disabled={saveCourier.isPending}>{tr("저장", "保存")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credentials dialog */}
      <Dialog open={!!credDialog} onOpenChange={(o) => !o && setCredDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{credDialog?.name} — {tr("API 인증정보", "API 认证信息")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              {tr(
                "인증정보는 서버에만 저장되며 화면에서 다시 조회할 수 없습니다. 변경할 항목만 입력하세요.",
                "认证信息仅保存在服务器，界面无法再次查看。仅填写需要修改的项目。"
              )}
            </p>
            <div className="space-y-2">
              <Label>{credDialog?.code === "yunexpress" ? "Customer ID (Account)" : "App Key"}</Label>
              <Input value={cred.api_key} onChange={(e) => setCred((c) => ({ ...c, api_key: e.target.value }))} placeholder={credDialog?.has_credentials ? "••••••••" : ""} />
            </div>
            <div className="space-y-2">
              <Label>{credDialog?.code === "yunexpress" ? "API Secret" : "App Secret"}</Label>
              <Input type="password" value={cred.api_secret} onChange={(e) => setCred((c) => ({ ...c, api_secret: e.target.value }))} placeholder={credDialog?.has_credentials ? "••••••••" : ""} />
            </div>
            <div className="space-y-2">
              <Label>{tr("거래처/계정 번호", "客户/账号编号")}</Label>
              <Input value={cred.account_no} onChange={(e) => setCred((c) => ({ ...c, account_no: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>{tr("배송 채널 코드", "运输渠道代码")}</Label>
              <Input value={cred.channel_code} onChange={(e) => setCred((c) => ({ ...c, channel_code: e.target.value }))} placeholder={tr("예: US-EXP", "例：US-EXP")} />
            </div>
            <div className="flex justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={!credDialog?.has_credentials || clearCreds.isPending}
                onClick={async () => {
                  if (!credDialog) return;
                  await clearCreds.mutateAsync(credDialog.code);
                  setCredDialog(null);
                  toast({ title: tr("인증정보가 삭제되었습니다", "认证信息已删除") });
                }}
              >
                {tr("삭제", "删除")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCredDialog(null)}>{tr("취소", "取消")}</Button>
                <Button onClick={handleSaveCred} disabled={saveCreds.isPending}>{tr("저장", "保存")}</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feature description */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <h4 className="text-sm font-medium">{tr("택배사 연동 시 지원 기능", "快递公司对接支持功能")}</h4>
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { title: tr("송장 자동 발급", "自动生成运单"), desc: tr("배송 관리에서 택배사를 선택하면 해당 API로 운송장번호를 발급받습니다", "在配送管理选择快递公司后，调用其API获取运单号") },
            { title: tr("라벨 PDF 다운로드", "标签PDF下载"), desc: tr("택배사에서 반환된 배송 라벨을 다운로드하여 출력합니다", "下载快递公司返回的配送标签并打印") },
            { title: tr("배송 추적 조회", "物流追踪查询"), desc: tr("운송장번호로 실시간 배송 상태를 조회합니다", "通过运单号实时查询配送状态") },
          ].map((f) => (
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

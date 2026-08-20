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
  useAdminCouriers,
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
  access_token: "",
  // YunExpress 신버전 OpenAPI (openapi.yunexpress.cn) 라벨 PDF 조회용
  openapi_app_id: "",
  openapi_app_secret: "",
  openapi_access_token: "",
  // 발송인 정보
  sender_name: "",
  sender_company: "",
  sender_phone: "",
  sender_country: "",
  sender_state: "",
  sender_city: "",
  sender_street: "",
  sender_post_code: "",
  // 반품지 주소
  returner_name: "",
  returner_company: "",
  returner_phone: "",
  returner_country: "",
  returner_state: "",
  returner_city: "",
  returner_street: "",
  returner_post_code: "",

  // 신고 정보
  hscode: "",
  unit_price: "",
  item_name_en: "",
  item_name_cn: "",
  brand: "",
  ref_label: "",
};

export default function CourierSettings() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();

  const { data: couriers = [], isLoading } = useAdminCouriers();
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
      access_token: s("access_token"),
      openapi_app_id: s("openapi_app_id") || s("openapi_token") || s("token"),
      openapi_app_secret: s("openapi_app_secret") || s("openapi_secret") || s("secret"),
      openapi_access_token: s("openapi_access_token"),
      sender_name: s("sender_name"),
      sender_company: s("sender_company"),
      sender_phone: s("sender_phone"),
      sender_country: s("sender_country"),
      sender_state: s("sender_state"),
      sender_city: s("sender_city"),
      sender_street: s("sender_street"),
      sender_post_code: s("sender_post_code"),
      returner_name: s("returner_name"),
      returner_company: s("returner_company"),
      returner_phone: s("returner_phone"),
      returner_country: s("returner_country"),
      returner_state: s("returner_state"),
      returner_city: s("returner_city"),
      returner_street: s("returner_street"),
      returner_post_code: s("returner_post_code"),

      hscode: s("hscode"),
      unit_price: s("unit_price"),
      item_name_en: s("item_name_en"),
      item_name_cn: s("item_name_cn"),
      brand: s("brand"),
      ref_label: s("ref_label"),

    }));
  }, [credDialog?.code, credExtra]);

  const handleSaveCred = async () => {
    if (!credDialog) return;
    // 브라우저 자동완성으로 이메일이 App Key에 들어가는 사고 방지
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cred.api_key.trim())) {
      toast({
        variant: "destructive",
        title: tr("App Key 값이 올바르지 않습니다", "App Key 值不正确"),
        description: tr(
          "이메일 주소가 입력되어 있습니다. 브라우저 자동완성 값을 지우고 실제 App Key를 입력하세요.",
          "当前填写的是邮箱地址。请清除浏览器自动填充内容并输入真实 App Key。",
        ),
      });
      return;
    }
    try {

      const base = (credExtra?.extra ?? {}) as Record<string, unknown>;
      const extra: Record<string, unknown> = { ...base };
      const put = (key: string, val: string) => {
        const v = val.trim();
        if (v) extra[key] = v;
        else delete extra[key];
      };
      put("channel_code", cred.channel_code);
      put("access_token", cred.access_token);
      put("openapi_app_id", cred.openapi_app_id);
      put("openapi_app_secret", cred.openapi_app_secret);
      put("openapi_access_token", cred.openapi_access_token);
      // 하위 호환: 기존 키도 동기화 (access token 우선)
      const effToken = cred.openapi_access_token.trim() || cred.openapi_app_id.trim();
      if (effToken) {
        extra.openapi_token = effToken;
      } else {
        delete extra.openapi_token;
      }
      if (cred.openapi_app_secret.trim()) {
        extra.openapi_secret = cred.openapi_app_secret.trim();
      } else {
        delete extra.openapi_secret;
      }
      put("sender_name", cred.sender_name);
      put("sender_company", cred.sender_company);
      put("sender_phone", cred.sender_phone);
      put("sender_country", cred.sender_country);
      put("sender_state", cred.sender_state);
      put("sender_city", cred.sender_city);
      put("sender_street", cred.sender_street);
      put("sender_post_code", cred.sender_post_code);
      put("returner_name", cred.returner_name);
      put("returner_company", cred.returner_company);
      put("returner_phone", cred.returner_phone);
      put("returner_country", cred.returner_country);
      put("returner_state", cred.returner_state);
      put("returner_city", cred.returner_city);
      put("returner_street", cred.returner_street);
      put("returner_post_code", cred.returner_post_code);

      put("hscode", cred.hscode);
      put("item_name_en", cred.item_name_en);
      put("item_name_cn", cred.item_name_cn);
      put("brand", cred.brand);
      put("ref_label", cred.ref_label);
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
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">

          <DialogHeader>
            <DialogTitle>{credDialog?.name} — {tr("API 인증정보", "API 认证信息")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* 브라우저 비밀번호 관리자 자동완성 방지용 디코이 필드 */}
            <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="hidden" />
            <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" className="hidden" />
            <p className="text-xs text-muted-foreground">
              {tr(
                "인증정보는 서버에만 저장되며 화면에서 다시 조회할 수 없습니다. 변경할 항목만 입력하세요.",
                "认证信息仅保存在服务器，界面无法再次查看。仅填写需要修改的项目。"
              )}
            </p>
            <div className="space-y-2">
              <Label>{credDialog?.code === "yunexpress" ? tr("API Key (密钥)", "API Key (密钥)") : "App Key"}</Label>
              <Input name="courier-app-key" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.api_key} onChange={(e) => setCred((c) => ({ ...c, api_key: e.target.value }))} placeholder={credDialog?.has_credentials ? "••••••••" : ""} />
              {credDialog?.code === "yunexpress" && (
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "云途 개방플랫폼에서 발급한 API 密钥(SecretKey). 고객코드가 아닙니다.",
                    "云途开放平台签发的 API 密钥(SecretKey)，不是客户代码。"
                  )}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{credDialog?.code === "yunexpress" ? tr("API Secret (미사용)", "API Secret (未使用)") : "App Secret"}</Label>
              <Input type="password" name="courier-app-secret" autoComplete="new-password" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.api_secret} onChange={(e) => setCred((c) => ({ ...c, api_secret: e.target.value }))} placeholder={credDialog?.has_credentials ? "••••••••" : ""} />
              {credDialog?.code === "yunexpress" && (
                <p className="text-xs text-muted-foreground">
                  {tr("YunExpress 인증에는 사용되지 않습니다. 비워두세요.", "YunExpress 认证不使用此项，可留空。")}
                </p>
              )}
            </div>

            {credDialog?.code === "yunexpress" && (
              <div className="rounded-md border border-dashed p-3 space-y-3 bg-muted/30">
                <p className="text-sm font-medium">{tr("YunExpress 신버전 OpenAPI", "云途新版 OpenAPI")}</p>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "택배사 모드가 테스트이면 샌드박스, 실서비스이면 운영 OpenAPI로 자동 연결됩니다. 승인받은 앱 환경과 모드를 반드시 일치시키세요.",
                    "快递模式为测试时连接沙箱，为正式时连接生产 OpenAPI。请确保模式与应用获批环境一致。",
                  )}
                </p>
                <div className="space-y-2">
                  <Label>{tr("OpenAPI AppId (Token)", "OpenAPI AppId (Token)")}</Label>
                  <Input name="yun-openapi-app-id" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.openapi_app_id} onChange={(e) => setCred((c) => ({ ...c, openapi_app_id: e.target.value }))} placeholder="6387f82c8548" />
                  <p className="text-xs text-muted-foreground">
                    {tr("메일로 받은 appId 값이며 OpenAPI token 헤더에 사용됩니다.", "邮件中的 appId，用于 OpenAPI token 请求头。")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{tr("OpenAPI AppSecret", "OpenAPI AppSecret")}</Label>
                  <Input type="password" name="yun-openapi-app-secret" autoComplete="new-password" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.openapi_app_secret} onChange={(e) => setCred((c) => ({ ...c, openapi_app_secret: e.target.value }))} placeholder="0f6d46a78295..." />
                  <p className="text-xs text-muted-foreground">
                    {tr("메일로 받은 appSecret 값. 라벨 조회 API 서명(sign) 생성에 사용됩니다.", "邮件中的 appSecret，用于生成标签查询 API 的 sign 签名。")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>{tr("OpenAPI Access Token (직접 입력)", "OpenAPI Access Token (手动填写)")}</Label>
                  <Input type="password" name="yun-openapi-access-token" autoComplete="new-password" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.openapi_access_token} onChange={(e) => setCred((c) => ({ ...c, openapi_access_token: e.target.value }))} placeholder="YunExpress 담당자에게 받은 access token" />
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "값이 입력되면 AppId 대신 이 토큰을 OpenAPI token 헤더로 사용합니다. 만료 시 새 토큰으로 교체하세요.",
                      "填写后将使用该令牌替代 AppId 作为 OpenAPI token 请求头。过期后请更换新令牌。",
                    )}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>
                {credDialog?.code === "yunexpress"
                  ? tr("Customer Code / Account No (客户代码) *필수", "客户代码 / 账号 *必填")
                  : tr("거래처/계정 번호", "客户/账号编号")}
              </Label>
              <Input name="courier-account-no" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.account_no} onChange={(e) => setCred((c) => ({ ...c, account_no: e.target.value }))} placeholder={credDialog?.code === "yunexpress" ? "CN0C031972" : ""} />
              {credDialog?.code === "yunexpress" && (
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "인증은 Base64(\"Account No & API Key\") 방식입니다. 비어 있으면 401 인증 실패가 발생합니다.",
                    "认证方式为 Base64(\"账号&API密钥\")。留空将导致 401 认证失败。"
                  )}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{tr("배송 채널 코드", "运输渠道代码")}</Label>
              <Input name="courier-channel-code" autoComplete="off" data-1p-ignore data-lpignore="true" data-form-type="other" value={cred.channel_code} onChange={(e) => setCred((c) => ({ ...c, channel_code: e.target.value }))} placeholder={tr("예: US-EXP", "例：US-EXP")} />
            </div>
            {credDialog?.code === "4px" && (
              <div className="space-y-2">
                <Label>Access Token</Label>
                <Input
                  name="courier-access-token"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-form-type="other"
                  value={cred.access_token}
                  onChange={(e) => setCred((c) => ({ ...c, access_token: e.target.value }))}
                  placeholder={tr("4PX 오픈플랫폼 授权 access_token", "4PX开放平台授权 access_token")}
                />

                <p className="text-xs text-muted-foreground">
                  {tr(
                    "주문생성(ds.xms.order.create)은 access_token 인증이 필요합니다. 없으면 '签名验证错误(000012)'가 발생합니다.",
                    "创建订单(ds.xms.order.create)需要access_token授权，否则会返回“签名验证错误(000012)”。"
                  )}
                </p>
              </div>
            )}


            <div className="pt-2 border-t space-y-3">
              <p className="text-sm font-medium">{tr("발송인 주소", "发件人地址")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("발송인명", "发件人")}</Label>
                  <Input value={cred.sender_name} onChange={(e) => setCred((c) => ({ ...c, sender_name: e.target.value }))} placeholder="TWINMETA" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("회사명", "公司名")}</Label>
                  <Input value={cred.sender_company} onChange={(e) => setCred((c) => ({ ...c, sender_company: e.target.value }))} placeholder="TWINMETA" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("전화번호", "电话")}</Label>
                  <Input value={cred.sender_phone} onChange={(e) => setCred((c) => ({ ...c, sender_phone: e.target.value }))} placeholder="13000000000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("우편번호", "邮编")}</Label>
                  <Input value={cred.sender_post_code} onChange={(e) => setCred((c) => ({ ...c, sender_post_code: e.target.value }))} placeholder="518000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("국가코드", "国家代码")}</Label>
                  <Input value={cred.sender_country} onChange={(e) => setCred((c) => ({ ...c, sender_country: e.target.value }))} placeholder="CN" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("주/성", "省")}</Label>
                  <Input value={cred.sender_state} onChange={(e) => setCred((c) => ({ ...c, sender_state: e.target.value }))} placeholder="GuangDong" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("도시", "城市")}</Label>
                  <Input value={cred.sender_city} onChange={(e) => setCred((c) => ({ ...c, sender_city: e.target.value }))} placeholder="Shenzhen" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("상세주소", "详细地址")}</Label>
                  <Input value={cred.sender_street} onChange={(e) => setCred((c) => ({ ...c, sender_street: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t space-y-3">
              <p className="text-sm font-medium">{tr("반품지 주소 (반송 수령지)", "退货地址")}</p>
              <p className="text-xs text-muted-foreground">
                {tr(
                  "발송은 중국에서 하지만 반품/반송은 미국에서 수령할 경우 여기에 미국 주소를 입력하세요. 비워두면 발송인 주소로 반송됩니다.",
                  "从中国发货但在美国接收退件时，请在此填写美国地址。留空则退回发件人地址。",
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("수령인명", "收件人")}</Label>
                  <Input value={cred.returner_name} onChange={(e) => setCred((c) => ({ ...c, returner_name: e.target.value }))} placeholder="TWINMETA US" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("회사명", "公司名")}</Label>
                  <Input value={cred.returner_company} onChange={(e) => setCred((c) => ({ ...c, returner_company: e.target.value }))} placeholder="TWINMETA INC" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("전화번호", "电话")}</Label>
                  <Input value={cred.returner_phone} onChange={(e) => setCred((c) => ({ ...c, returner_phone: e.target.value }))} placeholder="+1 305 555 0134" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("우편번호", "邮编")}</Label>
                  <Input value={cred.returner_post_code} onChange={(e) => setCred((c) => ({ ...c, returner_post_code: e.target.value }))} placeholder="33131" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("국가코드", "国家代码")}</Label>
                  <Input value={cred.returner_country} onChange={(e) => setCred((c) => ({ ...c, returner_country: e.target.value }))} placeholder="US" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("주(State)", "州")}</Label>
                  <Input value={cred.returner_state} onChange={(e) => setCred((c) => ({ ...c, returner_state: e.target.value }))} placeholder="FL" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("도시", "城市")}</Label>
                  <Input value={cred.returner_city} onChange={(e) => setCred((c) => ({ ...c, returner_city: e.target.value }))} placeholder="Miami" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("상세주소", "详细地址")}</Label>
                  <Input value={cred.returner_street} onChange={(e) => setCred((c) => ({ ...c, returner_street: e.target.value }))} placeholder="1200 Brickell Ave Suite 1950" />
                </div>
              </div>
            </div>



            <div className="pt-2 border-t space-y-3">
              <p className="text-sm font-medium">{tr("통관 신고 정보", "报关申报信息")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("HS코드", "HS编码")}</Label>
                  <Input value={cred.hscode} onChange={(e) => setCred((c) => ({ ...c, hscode: e.target.value }))} placeholder="6109100010" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("신고단가 (USD)", "申报单价 (USD)")}</Label>
                  <Input type="number" step="0.01" min="0" value={cred.unit_price} onChange={(e) => setCred((c) => ({ ...c, unit_price: e.target.value }))} placeholder="10" />
                  <p className="text-[11px] text-amber-500 leading-tight">
                    {tr(
                      "미국 관세는 신고가액에 대해 27.5%가 추가 부과된다는 점에 유의하십시오.",
                      "请注意，美国关税将对申报价值额外加征27.5%。"
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("품명 (영문)", "品名 (英文)")}</Label>
                  <Input value={cred.item_name_en} onChange={(e) => setCred((c) => ({ ...c, item_name_en: e.target.value }))} placeholder="T-Shirt" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tr("품명 (중문)", "品名 (中文)")}</Label>
                  <Input value={cred.item_name_cn} onChange={(e) => setCred((c) => ({ ...c, item_name_cn: e.target.value }))} placeholder="T恤" />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">{tr("브랜드", "品牌")}</Label>
                  <Input value={cred.brand} onChange={(e) => setCred((c) => ({ ...c, brand: e.target.value }))} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">{tr("송장 Ref No 표기", "面单 Ref No 显示")}</Label>
                  <Input
                    value={cred.ref_label}
                    onChange={(e) => setCred((c) => ({ ...c, ref_label: e.target.value }))}
                    placeholder={[cred.brand, cred.item_name_en].filter(Boolean).join(" ") || "TWINMETA T-Shirt"}
                    className={cred.ref_label && cred.ref_label.length > 32 ? "border-destructive text-destructive" : ""}
                  />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      {tr(
                        "4PX 송장의 Ref No 칸에 인쇄되는 문구입니다. 비워두면 브랜드 + 품명(영문)이 자동으로 사용됩니다. 영문/숫자만 가능하며 32자까지 인쇄됩니다.",
                        "打印在4PX面单 Ref No 栏的文字。留空则自动使用 品牌 + 英文品名。仅支持英文数字，最多32个字符。",
                      )}
                    </p>
                    <span className={`text-[11px] shrink-0 ${cred.ref_label && cred.ref_label.length > 32 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {(cred.ref_label ?? "").length}/32
                    </span>
                  </div>
                </div>
              </div>
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

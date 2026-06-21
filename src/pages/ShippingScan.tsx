import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, AlertTriangle, ScanLine, Truck, Send, Printer, RefreshCw } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useShipmentScan } from "@/hooks/useShipmentScan";
import { useAddressBook } from "@/hooks/useAddressBook";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { scanSuccess, scanFail, scanDuplicate } from "@/lib/scan-sound";
import { Html5Qrcode } from "html5-qrcode";
import { ScrollArea } from "@/components/ui/scroll-area";

type FeedbackKind = "success" | "duplicate" | "mismatch" | "notfound" | "idle";

export default function ShippingScan() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { lang } = useLang();
  const isKo = lang === "ko";
  const tr = (ko: string, zh: string) => (isKo ? ko : zh);
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useShipmentScan(orderId);
  const { data: addressBook = [] } = useAddressBook(orderId);
  const shipment = data?.shipment;
  const items = data?.items ?? [];
  const order: any = shipment?.orders;
  const total = order?.quantity ?? 0;
  const scannedCount = items.filter((i) => i.is_scanned).length;
  const allScanned = total > 0 && scannedCount === total;

  const [scanInput, setScanInput] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: FeedbackKind; msg: string }>({ kind: "idle", msg: "" });
  const [designConfirmed, setDesignConfirmed] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [labelDialog, setLabelDialog] = useState(false);
  const [carrier, setCarrier] = useState("4px");
  const [manualTracking, setManualTracking] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "shipping-qr-reader";
  const lastScanRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  useEffect(() => {
    if (shipment) setDesignConfirmed(!!shipment.design_confirmed);
  }, [shipment?.id]);

  // Keep keyboard focus on USB-scanner input
  useEffect(() => {
    const refocus = () => inputRef.current?.focus();
    refocus();
    const interval = setInterval(() => {
      if (!cameraOn && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        refocus();
      }
    }, 800);
    return () => clearInterval(interval);
  }, [cameraOn]);

  // Camera scanner lifecycle
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    (async () => {
      try {
        const html5 = new Html5Qrcode(scannerDivId);
        scannerRef.current = html5;
        await html5.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => { if (!cancelled) handleScan(decoded); },
          () => {}
        );
      } catch (err: any) {
        toast({ variant: "destructive", title: tr("카메라 오류", "相机错误"), description: String(err?.message ?? err) });
        setCameraOn(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        Promise.resolve(s.stop()).catch(() => {}).finally(() => { try { s.clear(); } catch { /* ignore */ } });
        scannerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  async function logAction(action: string, details: any) {
    await supabase.from("shipping_logs").insert({
      shipment_id: shipment?.id,
      order_id: orderId,
      action_type: action,
      worker_id: user?.id,
      details,
    });
  }

  async function handleScan(rawValue: string) {
    const qrValue = rawValue.trim();
    if (!qrValue || !shipment || !order) return;

    // debounce camera duplicates within 1.5s
    const now = Date.now();
    if (lastScanRef.current.value === qrValue && now - lastScanRef.current.at < 1500) return;
    lastScanRef.current = { value: qrValue, at: now };

    // Already scanned in this shipment?
    if (items.some((i) => i.qr_value === qrValue && i.is_scanned)) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("이미 스캔된 QR입니다", "该二维码已扫描") });
      await logAction("duplicate", { qrValue });
      return;
    }

    // Look up in hologram master — the QR on the hologram sticker identifies the parcel.
    const { data: master, error } = await supabase
      .from("qr_hologram_master")
      .select("qr_value, serial_number, hologram_type")
      .eq("qr_value", qrValue)
      .maybeSingle();

    if (error || !master) {
      scanFail();
      setFeedback({ kind: "notfound", msg: tr("등록되지 않은 홀로그램 QR입니다", "未注册的全息二维码") });
      await logAction("notfound", { qrValue });
      return;
    }

    // Fill next empty slot
    const slot = items.find((i) => !i.is_scanned);
    if (!slot) {
      scanDuplicate();
      setFeedback({ kind: "duplicate", msg: tr("모든 슬롯이 가득 찼습니다", "已全部扫描完成") });
      return;
    }

    const { error: upErr } = await supabase
      .from("shipment_scan_items")
      .update({
        qr_value: qrValue,
        is_scanned: true,
        scanned_at: new Date().toISOString(),
        scanned_by: user?.id,
      })
      .eq("id", slot.id);

    if (upErr) {
      scanFail();
      setFeedback({ kind: "notfound", msg: upErr.message });
      return;
    }

    const newCount = scannedCount + 1;
    await supabase
      .from("shipments")
      .update({
        scanned_count: newCount,
        scan_status: newCount >= total ? (shipment.scan_status === "ready" || shipment.scan_status === "shipped" ? shipment.scan_status : "scanning") : "scanning",
      })
      .eq("id", shipment.id);

    await logAction("scan", { qrValue, position: slot.position });
    scanSuccess();
    setFeedback({ kind: "success", msg: tr(`${slot.position}번 슬롯 스캔 완료 (${newCount}/${total})`, `第 ${slot.position} 槽完成 (${newCount}/${total})`) });
    setScanInput("");
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = scanInput;
      setScanInput("");
      if (v.trim()) handleScan(v);
    }
  }

  async function toggleDesignConfirmed(v: boolean) {
    setDesignConfirmed(v);
    if (!shipment) return;
    await supabase.from("shipments").update({ design_confirmed: v }).eq("id", shipment.id);
  }

  function genMockTracking() {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `MOCK-${ymd}-${rnd}`;
  }

  async function issueTracking(autoMock: boolean) {
    if (!shipment) return;
    const trackingNumber = autoMock ? genMockTracking() : manualTracking.trim();
    if (!trackingNumber) {
      toast({ variant: "destructive", title: tr("송장번호를 입력하세요", "请输入运单号") });
      return;
    }
    setIssuing(true);
    const { error } = await supabase
      .from("shipments")
      .update({
        tracking_number: trackingNumber,
        carrier,
        scan_status: "ready",
        status: "label_received",
        tracking_issued_at: new Date().toISOString(),
      })
      .eq("id", shipment.id);
    setIssuing(false);
    if (error) {
      toast({ variant: "destructive", title: tr("발급 실패", "出运单失败"), description: error.message });
      return;
    }
    await logAction("issue_tracking", { trackingNumber, carrier, mock: autoMock });
    toast({ title: tr("송장이 발급되었습니다", "已生成运单"), description: trackingNumber });
    setLabelDialog(true);
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  async function markShippedAndReport() {
    if (!shipment) return;
    await supabase
      .from("shipments")
      .update({ scan_status: "shipped", status: "shipped", shipped_at: new Date().toISOString() })
      .eq("id", shipment.id);
    await logAction("report", { tracking_number: shipment.tracking_number });
    // notify_tracking_update trigger fires on tracking_number change; here we already set it earlier.
    // Mark reported optimistically (callback function will also flip it).
    await supabase.from("shipments").update({ scan_status: "reported", reported_at: new Date().toISOString() }).eq("id", shipment.id);
    toast({ title: tr("트윈메타에 회신되었습니다", "已回报至 TWINMETA") });
    setLabelDialog(false);
    qc.invalidateQueries({ queryKey: ["shipment_scan", orderId] });
  }

  function downloadLabelPdf() {
    if (!shipment) return;
    const w = window.open("", "_blank", "width=400,height=600");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Label ${shipment.tracking_number}</title>
      <style>body{font-family:sans-serif;padding:16px;}.box{border:2px solid #000;padding:12px;}.tn{font-size:18px;font-weight:bold;letter-spacing:1px;}h2{margin:4px 0;}</style>
      </head><body><div class="box">
      <h2>${shipment.carrier?.toUpperCase()}</h2>
      <p class="tn">${shipment.tracking_number}</p>
      <hr/>
      <p><b>${order?.recipient_name ?? ""}</b><br/>${order?.shipping_address ?? ""}<br/>${[order?.shipping_city, order?.shipping_state, order?.shipping_zip].filter(Boolean).join(", ")}<br/>${order?.shipping_country ?? ""}</p>
      <p>Job No: ${order?.external_order_id ?? ""} · Qty: ${total}</p>
      </div><script>window.print();</script></body></html>`);
    w.document.close();
  }

  const feedbackBox = useMemo(() => {
    if (feedback.kind === "idle") return null;
    const map: Record<FeedbackKind, string> = {
      success: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
      duplicate: "bg-amber-500/15 border-amber-500/40 text-amber-300",
      mismatch: "bg-destructive/15 border-destructive/40 text-destructive",
      notfound: "bg-destructive/15 border-destructive/40 text-destructive",
      idle: "",
    };
    const Icon = feedback.kind === "success" ? CheckCircle2 : AlertTriangle;
    return (
      <Alert className={`${map[feedback.kind]} border`}>
        <Icon className="w-4 h-4" />
        <AlertDescription className="font-medium">{feedback.msg}</AlertDescription>
      </Alert>
    );
  }, [feedback]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{tr("불러오는 중...", "加载中...")}</div>;
  if (!shipment) return (
    <div className="p-8 text-center space-y-3">
      <p className="text-muted-foreground">{tr("주문을 찾을 수 없습니다", "找不到订单")}</p>
      <Button variant="outline" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록", "返回")}</Button>
    </div>
  );

  const readyToIssue = allScanned && designConfirmed && !shipment.tracking_number;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/shipping")}><ArrowLeft className="w-4 h-4 mr-1"/>{tr("목록으로", "返回列表")}</Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1"/>{tr("새로고침", "刷新")}</Button>
        </div>
      </div>

      <PageHeader title={`QR ${tr("스캔 작업", "扫码作业")}`} description={`Job No · ${order?.external_order_id}`} />

      <div className="grid lg:grid-cols-4 gap-4">
        {/* Address book */}
        <Card className="lg:col-span-1 lg:row-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{tr("주소록", "地址簿")}</span>
              <Badge variant="outline" className="font-mono">{addressBook.length}</Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">{tr("배송 대기 주문 목록", "待发货订单列表")}</p>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[420px]">
              <ul className="divide-y">
                {addressBook.map((row: any) => {
                  const o = row.orders;
                  const active = row.order_id === orderId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/shipping/scan/${row.order_id}`)}
                        className={`w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors ${active ? "bg-primary/10 border-l-2 border-primary" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs truncate">{o?.external_order_id}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{row.scan_status}</Badge>
                        </div>
                        <div className="text-sm font-medium truncate">{o?.recipient_name ?? "-"}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {[o?.shipping_city, o?.shipping_state, o?.shipping_country].filter(Boolean).join(", ")}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {o?.shipping_address}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                          <span>Qty {o?.quantity ?? 0}</span>
                          {row.tracking_number && <span className="font-mono truncate ml-2">{row.tracking_number}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {addressBook.length === 0 && (
                  <li className="p-4 text-center text-xs text-muted-foreground">{tr("표시할 주소가 없습니다", "暂无地址")}</li>
                )}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Scanner panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><ScanLine className="w-4 h-4"/>{tr("홀로그램 스티커 QR 스캔", "扫描全息贴纸二维码")}</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              {tr("홀로그램 스티커의 QR을 스캔하면 해당 주소지와 매칭되어 송장이 생성됩니다.", "扫描全息贴纸二维码后将匹配收件地址并生成运单。")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={tr("USB 스캐너 또는 직접 입력 후 Enter", "USB 扫描或输入后回车")}
                className="font-mono"
                autoFocus
              />
              <Button variant={cameraOn ? "destructive" : "outline"} onClick={() => setCameraOn((v) => !v)}>
                {cameraOn ? <CameraOff className="w-4 h-4 mr-1"/> : <Camera className="w-4 h-4 mr-1"/>}
                {cameraOn ? tr("카메라 끄기", "关闭相机") : tr("카메라", "相机")}
              </Button>
            </div>
            {cameraOn && <div id={scannerDivId} className="rounded-lg overflow-hidden bg-black aspect-video max-w-md mx-auto" />}
            {feedbackBox}
          </CardContent>
        </Card>

        {/* Order panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tr("주문 정보", "订单信息")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Job No</span><span className="font-mono">{order?.external_order_id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Twinker</span><span>{order?.recipient_name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">{tr("전화", "电话")}</span><span className="font-mono text-xs">{order?.recipient_phone ?? "-"}</span></div>
            <div className="text-muted-foreground pt-1">{tr("주소", "地址")}</div>
            <div className="text-xs">{order?.shipping_address}, {order?.shipping_city}, {order?.shipping_state} {order?.shipping_zip}</div>
            <div className="pt-2 border-t flex items-center justify-between">
              <span className="text-muted-foreground">{tr("진행률", "进度")}</span>
              <span className="font-mono">{scannedCount}/{total}</span>
            </div>
            <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: total ? `${(scannedCount / total) * 100}%` : "0%" }} />
            </div>
            <div className="pt-2">
              <Badge variant="outline" className="capitalize">{shipment.scan_status}</Badge>
              {shipment.tracking_number && (
                <div className="mt-2 text-xs font-mono break-all p-2 rounded bg-muted">{shipment.carrier?.toUpperCase()} · {shipment.tracking_number}</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Design verification grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{tr("디자인 검수", "设计检验")}</span>
            <label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={designConfirmed} onCheckedChange={(v) => toggleDesignConfirmed(!!v)} />
              {tr("디자인 확인 완료", "设计已确认")}
            </label>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map((it) => (
              <div key={it.id} className={`rounded-lg border overflow-hidden ${it.is_scanned ? "border-emerald-500/40" : "border-border"}`}>
                <div className="aspect-square bg-muted relative flex items-center justify-center">
                  {it.design_image_url ? (
                    <img src={it.design_image_url} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">{tr("이미지 없음", "无图")}</span>
                  )}
                  <div className="absolute top-1 left-1 text-[10px] bg-background/80 rounded px-1.5 py-0.5 font-mono">#{it.position}</div>
                  {it.is_scanned && (
                    <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    </div>
                  )}
                </div>
                <div className="p-2 text-[11px] space-y-0.5">
                  <div className="font-mono truncate" title={it.qr_value ?? ""}>{it.qr_value ?? tr("대기", "待扫")}</div>
                  <div className="text-muted-foreground truncate">{[it.color, it.size].filter(Boolean).join(" · ") || "-"}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Action bar */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1 grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{tr("택배사", "承运商")}</Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="4px">4PX</SelectItem>
                  <SelectItem value="yunexpress">YunExpress</SelectItem>
                  <SelectItem value="cjlogistics">CJ Logistics</SelectItem>
                  <SelectItem value="usps">USPS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{tr("송장번호 (수기 입력 시)", "运单号（手动输入）")}</Label>
              <Input value={manualTracking} onChange={(e) => setManualTracking(e.target.value)} placeholder={tr("비워두면 자동발급(MOCK)", "留空则自动生成 (MOCK)")} className="font-mono"/>
            </div>
          </div>
          <div className="flex gap-2">
            <Button disabled={!readyToIssue || issuing} onClick={() => issueTracking(!manualTracking.trim())}>
              <Truck className="w-4 h-4 mr-1"/>{tr("송장 발급", "出运单")}
            </Button>
            <Button variant="outline" disabled={!shipment.tracking_number} onClick={downloadLabelPdf}>
              <Printer className="w-4 h-4 mr-1"/>{tr("라벨 출력", "打印标签")}
            </Button>
            <Button variant="secondary" disabled={!shipment.tracking_number || shipment.scan_status === "reported"} onClick={markShippedAndReport}>
              <Send className="w-4 h-4 mr-1"/>{tr("발송 + 회신", "发货并回报")}
            </Button>
          </div>
        </CardContent>
        {!allScanned && (
          <div className="px-4 pb-4 text-xs text-muted-foreground">{tr("모든 상품을 스캔하고 디자인 확인을 체크하면 송장 발급이 활성화됩니다.", "完成全部扫描并确认设计后方可出运单。")}</div>
        )}
      </Card>

      {/* Label dialog */}
      <Dialog open={labelDialog} onOpenChange={setLabelDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr("송장 발급 완료", "运单已生成")}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="p-3 rounded bg-muted font-mono text-center text-lg">{shipment.tracking_number}</div>
            <p className="text-muted-foreground">{tr("라벨을 출력하고 발송 후 트윈메타에 회신하세요.", "请打印标签，发货后回报 TWINMETA。")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={downloadLabelPdf}><Printer className="w-4 h-4 mr-1"/>{tr("라벨 출력", "打印标签")}</Button>
            <Button onClick={markShippedAndReport}><Send className="w-4 h-4 mr-1"/>{tr("발송 + 회신", "发货并回报")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

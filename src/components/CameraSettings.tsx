import React, { useEffect, useState } from "react";
import { useLang } from "@/contexts/LangContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Video, VideoOff, Save, RefreshCw, Radio } from "lucide-react";
import {
  GatewayCamera,
  listGatewayCameras,
  createGatewayCamera,
  patchGatewayCamera,
  deleteGatewayCamera,
  setGatewayRecording,
} from "@/lib/cctv-api";

interface EditState {
  id: string;
  isNew: boolean;
  input_url: string;
  rtsp_transport: string;
  live_transcode: boolean;
  enabled: boolean;
  display_name: string;
}

export default function CameraSettings() {
  const { lang } = useLang();
  const { toast } = useToast();
  const isKo = lang === "ko";

  const [cameras, setCameras] = useState<GatewayCamera[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<EditState | null>(null);

  const fail = (err: any) =>
    toast({ title: isKo ? "오류" : "错误", description: err?.message ?? String(err), variant: "destructive" });

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [cams, settings] = await Promise.all([
        listGatewayCameras(),
        supabase.from("cctv_camera_settings").select("camera_id, display_name, sort_order").order("sort_order"),
      ]);
      const map: Record<string, string> = {};
      for (const row of settings.data ?? []) if (row.display_name) map[row.camera_id] = row.display_name;
      const order = (settings.data ?? []).map((r) => r.camera_id);
      const idx = new Map(order.map((id, i) => [id, i]));
      setCameras(
        [...cams].sort(
          (a, b) => (idx.get(a.id) ?? 9999) - (idx.get(b.id) ?? 9999) || a.id.localeCompare(b.id),
        ),
      );
      setNames(map);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const openAdd = () => {
    setEditItem({
      id: "",
      isNew: true,
      input_url: "",
      rtsp_transport: "tcp",
      live_transcode: false,
      enabled: true,
      display_name: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (cam: GatewayCamera) => {
    setEditItem({
      id: cam.id,
      isNew: false,
      input_url: cam.input_url ?? "",
      rtsp_transport: cam.rtsp_transport ?? "tcp",
      live_transcode: !!cam.live_transcode,
      enabled: !!cam.enabled,
      display_name: names[cam.id] ?? "",
    });
    setDialogOpen(true);
  };

  const saveDisplayName = async (cameraId: string, displayName: string) => {
    const sort = cameras.findIndex((c) => c.id === cameraId);
    await supabase.from("cctv_camera_settings").upsert(
      { camera_id: cameraId, display_name: displayName.trim() || null, sort_order: sort >= 0 ? sort : 0 },
      { onConflict: "camera_id" },
    );
  };

  const handleSave = async () => {
    if (!editItem) return;
    if (!editItem.id.trim()) {
      toast({
        title: isKo ? "경고" : "警告",
        description: isKo ? "카메라 ID는 필수입니다." : "摄像头 ID 为必填项。",
        variant: "destructive",
      });
      return;
    }
    if (editItem.isNew && !/^[A-Za-z0-9_-]+$/.test(editItem.id.trim())) {
      toast({
        title: isKo ? "경고" : "警告",
        description: isKo ? "ID는 영문/숫자/-/_ 만 사용할 수 있습니다." : "ID 仅允许字母、数字、- 和 _。",
        variant: "destructive",
      });
      return;
    }
    try {
      setBusyId(editItem.id);
      const payload = {
        input_url: editItem.input_url.trim() || "testsrc",
        rtsp_transport: editItem.rtsp_transport || "tcp",
        live_transcode: editItem.live_transcode,
        enabled: editItem.enabled,
      };
      if (editItem.isNew) {
        await createGatewayCamera({ id: editItem.id.trim(), ...payload });
      } else {
        await patchGatewayCamera(editItem.id, payload);
      }
      await saveDisplayName(editItem.id.trim(), editItem.display_name);
      toast({ title: editItem.isNew ? (isKo ? "등록되었습니다" : "添加成功") : (isKo ? "수정되었습니다" : "修改成功") });
      setDialogOpen(false);
      setEditItem(null);
      fetchAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (cam: GatewayCamera) => {
    const label = names[cam.id] || cam.id;
    if (!window.confirm(isKo ? `"${label}" 카메라를 삭제하시겠습니까? (저장된 녹화 파일은 유지됩니다)` : `确定要删除 "${label}" 摄像头吗？（已保存的录像将保留）`)) return;
    try {
      setBusyId(cam.id);
      await deleteGatewayCamera(cam.id);
      await supabase.from("cctv_camera_settings").delete().eq("camera_id", cam.id);
      toast({ title: isKo ? "삭제되었습니다" : "已删除" });
      fetchAll();
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const toggleRecording = async (cam: GatewayCamera) => {
    try {
      setBusyId(cam.id);
      await setGatewayRecording(cam.id, !cam.enabled);
      toast({ title: isKo ? "상태가 변경되었습니다" : "状态已更改" });
      // The recorder needs a moment to (re)start before it reports back.
      setTimeout(fetchAll, 1200);
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{isKo ? "카메라 연동 및 관리" : "摄像头对接与管理"}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isKo
              ? "게이트웨이(/api/v1/cam)에 등록된 카메라를 실시간으로 불러옵니다."
              : "实时读取网关 (/api/v1/cam) 已注册的摄像头。"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {isKo ? "새로고침" : "刷新"}
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openAdd}>
            <Plus className="w-4 h-4" />
            {isKo ? "카메라 추가" : "添加摄像头"}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{isKo ? "카메라 ID" : "摄像头 ID"}</TableHead>
              <TableHead>{isKo ? "표시 이름" : "显示名称"}</TableHead>
              <TableHead>{isKo ? "입력 주소 (RTSP)" : "输入地址 (RTSP)"}</TableHead>
              <TableHead>{isKo ? "트랜스코딩" : "转码"}</TableHead>
              <TableHead>{isKo ? "실행 상태" : "运行状态"}</TableHead>
              <TableHead>{isKo ? "녹화 활성화" : "启用录像"}</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {isKo ? "로딩 중..." : "加载中..."}
                </TableCell>
              </TableRow>
            ) : cameras.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  {isKo ? "게이트웨이에 등록된 카메라가 없습니다." : "网关中暂无摄像头。"}
                </TableCell>
              </TableRow>
            ) : (
              cameras.map((cam) => (
                <TableRow key={cam.id}>
                  <TableCell>
                    {cam.recording ? (
                      <Video className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <VideoOff className="w-4 h-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">{cam.id}</TableCell>
                  <TableCell className="font-medium">
                    {names[cam.id] || <span className="text-muted-foreground">{isKo ? "미지정" : "未指定"}</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[240px] truncate" title={cam.input_url}>
                    {cam.input_url}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{cam.live_transcode ? "H.264 transcode" : "copy"}</Badge>
                  </TableCell>
                  <TableCell>
                    {cam.recording ? (
                      <Badge className="gap-1 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">
                        <Radio className="w-3 h-3" />
                        {isKo ? "녹화중" : "录像中"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">{isKo ? "정지" : "已停止"}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={cam.enabled}
                      disabled={busyId === cam.id}
                      onCheckedChange={() => toggleRecording(cam)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cam)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => confirmDelete(cam)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editItem?.isNew ? (isKo ? "카메라 등록" : "注册摄像头") : (isKo ? "카메라 수정" : "修改摄像头")}
            </DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="space-y-1.5">
                <Label>{isKo ? "카메라 ID" : "摄像头 ID"}</Label>
                <Input
                  value={editItem.id}
                  disabled={!editItem.isNew}
                  onChange={(e) => setEditItem({ ...editItem, id: e.target.value })}
                  placeholder="cam6"
                />
                {editItem.isNew && (
                  <p className="text-xs text-muted-foreground">
                    {isKo ? "영문/숫자/-/_ 만 사용 (등록 후 변경 불가)" : "仅限字母、数字、- 和 _（注册后不可更改）"}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>{isKo ? "표시 이름" : "显示名称"}</Label>
                <Input
                  value={editItem.display_name}
                  onChange={(e) => setEditItem({ ...editItem, display_name: e.target.value })}
                  placeholder={isKo ? "예: 포장 작업대 1" : "例如: 包装工作台 1"}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{isKo ? "입력 주소 (RTSP)" : "输入地址 (RTSP)"}</Label>
                <Input
                  value={editItem.input_url}
                  onChange={(e) => setEditItem({ ...editItem, input_url: e.target.value })}
                  placeholder="rtsp://admin:admin@192.168.1.16:554/stream"
                />
                <p className="text-xs text-muted-foreground">
                  {isKo ? "비워두면 테스트 영상(testsrc)으로 등록됩니다." : "留空则以测试画面 (testsrc) 注册。"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>RTSP Transport</Label>
                <Input
                  value={editItem.rtsp_transport}
                  onChange={(e) => setEditItem({ ...editItem, rtsp_transport: e.target.value })}
                  placeholder="tcp"
                />
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label>{isKo ? "라이브 트랜스코딩" : "实时转码"}</Label>
                  <p className="text-xs text-muted-foreground">
                    {isKo ? "H.265 카메라일 때 켜세요 (CPU 사용 증가)" : "H.265 摄像头请开启（CPU 占用增加）"}
                  </p>
                </div>
                <Switch
                  checked={editItem.live_transcode}
                  onCheckedChange={(checked) => setEditItem({ ...editItem, live_transcode: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>{isKo ? "녹화 활성화" : "启用录像"}</Label>
                <Switch
                  checked={editItem.enabled}
                  onCheckedChange={(checked) => setEditItem({ ...editItem, enabled: checked })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {isKo ? "취소" : "取消"}
                </Button>
                <Button className="gap-1.5" onClick={handleSave} disabled={busyId !== null}>
                  <Save className="w-4 h-4" />
                  {isKo ? "저장" : "保存"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

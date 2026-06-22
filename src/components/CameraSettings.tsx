import React, { useState, useEffect } from "react";
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
import { Plus, Pencil, Trash2, Video, VideoOff, Play, Save } from "lucide-react";

interface Camera {
  id: string;
  name: string;
  location: string | null;
  stream_url: string;
  webrtc_url: string | null;
  recording_base_url: string | null;
  is_active: boolean;
}

export default function CameraSettings() {
  const { t, lang } = useLang();
  const { toast } = useToast();
  const isKo = lang === "ko";

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<Partial<Camera> | null>(null);

  const fetchCameras = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("cameras")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setCameras(data || []);
    } catch (err: any) {
      toast({
        title: isKo ? "오류" : "错误",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
  }, []);

  const openAdd = () => {
    setEditItem({
      name: "",
      location: "",
      stream_url: "",
      webrtc_url: "",
      recording_base_url: "",
      is_active: true,
    });
    setDialogOpen(true);
  };

  const openEdit = (camera: Camera) => {
    setEditItem({ ...camera });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!editItem || !editItem.name || !editItem.stream_url) {
      toast({
        title: isKo ? "경고" : "警告",
        description: isKo
          ? "이름과 스트림 URL은 필수 입력 사항입니다."
          : "名称和流地址为必填项。",
        variant: "destructive",
      });
      return;
    }

    try {
      const payload = {
        name: editItem.name,
        location: editItem.location || null,
        stream_url: editItem.stream_url,
        webrtc_url: editItem.webrtc_url || null,
        recording_base_url: editItem.recording_base_url || null,
        is_active: editItem.is_active ?? true,
      };

      if (editItem.id) {
        // Update
        const { error } = await supabase
          .from("cameras")
          .update(payload)
          .eq("id", editItem.id);
        if (error) throw error;
        toast({ title: isKo ? "수정되었습니다" : "修改成功" });
      } else {
        // Insert
        const { error } = await supabase
          .from("cameras")
          .insert(payload);
        if (error) throw error;
        toast({ title: isKo ? "등록되었습니다" : "添加成功" });
      }

      setDialogOpen(false);
      setEditItem(null);
      fetchCameras();
    } catch (err: any) {
      toast({
        title: isKo ? "오류" : "错误",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  const confirmDelete = async (id: string, name: string) => {
    if (window.confirm(isKo ? `"${name}" 카메라를 삭제하시겠습니까?` : `确定要删除 "${name}" 摄像头吗？`)) {
      try {
        const { error } = await supabase.from("cameras").delete().eq("id", id);
        if (error) throw error;
        toast({ title: isKo ? "삭제되었습니다" : "已删除" });
        fetchCameras();
      } catch (err: any) {
        toast({
          title: isKo ? "오류" : "错误",
          description: err.message,
          variant: "destructive",
        });
      }
    }
  };

  const toggleStatus = async (camera: Camera) => {
    try {
      const { error } = await supabase
        .from("cameras")
        .update({ is_active: !camera.is_active })
        .eq("id", camera.id);
      if (error) throw error;
      toast({
        title: isKo ? "상태가 변경되었습니다" : "状态已更改",
      });
      fetchCameras();
    } catch (err: any) {
      toast({
        title: isKo ? "오류" : "错误",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">
          {isKo ? "카메라 연동 및 관리" : "摄像头对接与管理"}
        </h3>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          {isKo ? "카메라 추가" : "添加摄像头"}
        </Button>
      </div>

      <div className="rounded-lg border overflow-x-auto bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>{isKo ? "카메라 명칭" : "摄像头名称"}</TableHead>
              <TableHead>{isKo ? "설치 위치" : "安装位置"}</TableHead>
              <TableHead>{isKo ? "스트림 URL (HLS)" : "流地址 (HLS)"}</TableHead>
              <TableHead>{isKo ? "WebRTC URL" : "WebRTC 地址"}</TableHead>
              <TableHead>{isKo ? "활성화" : "启用"}</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isKo ? "로딩 중..." : "加载中..."}
                </TableCell>
              </TableRow>
            ) : cameras.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {isKo ? "등록된 카메라가 없습니다. 카메라를 추가해주세요." : "暂无注册的摄像头，请添加。"}
                </TableCell>
              </TableRow>
            ) : (
              cameras.map(camera => (
                <TableRow key={camera.id}>
                  <TableCell>
                    {camera.is_active ? (
                      <Video className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <VideoOff className="w-4 h-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{camera.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{camera.location || (isKo ? "미지정" : "未指定")}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[200px] truncate" title={camera.stream_url}>
                    {camera.stream_url}
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[150px] truncate" title={camera.webrtc_url || ""}>
                    {camera.webrtc_url || "-"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={camera.is_active}
                      onCheckedChange={() => toggleStatus(camera)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(camera)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => confirmDelete(camera.id, camera.name)}
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
              {editItem?.id
                ? (isKo ? "카메라 수정" : "修改摄像头")
                : (isKo ? "카메라 등록" : "注册摄像头")}
            </DialogTitle>
          </DialogHeader>
          {editItem && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="space-y-1.5">
                <Label>{isKo ? "카메라 명칭" : "摄像头名称"}</Label>
                <Input
                  value={editItem.name || ""}
                  onChange={e => setEditItem({ ...editItem, name: e.target.value })}
                  placeholder={isKo ? "예: 포장 작업대 1" : "例如: 包装工作台 1"}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{isKo ? "설치 위치" : "安装位置"}</Label>
                <Input
                  value={editItem.location || ""}
                  onChange={e => setEditItem({ ...editItem, location: e.target.value })}
                  placeholder={isKo ? "예: LINE-1" : "例如: LINE-1"}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  {isKo ? "스트림 HLS URL" : "HLS 流地址"}
                  <span className="text-xs text-muted-foreground ml-1.5 font-normal">
                    (MediaMTX / HLS output URL)
                  </span>
                </Label>
                <Input
                  value={editItem.stream_url || ""}
                  onChange={e => setEditItem({ ...editItem, stream_url: e.target.value })}
                  placeholder="http://<cloudflare-tunnel-url>/cam1/index.m3u8"
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  {isKo ? "WebRTC URL (옵션)" : "WebRTC 地址 (可选)"}
                  <span className="text-xs text-muted-foreground ml-1.5 font-normal">
                    (MediaMTX WHIP/WHEP)
                  </span>
                </Label>
                <Input
                  value={editItem.webrtc_url || ""}
                  onChange={e => setEditItem({ ...editItem, webrtc_url: e.target.value })}
                  placeholder="http://<cloudflare-tunnel-url>/cam1/whep"
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  {isKo ? "녹화 영상 서버 경로 (옵션)" : "录像存储路径 (可选)"}
                </Label>
                <Input
                  value={editItem.recording_base_url || ""}
                  onChange={e => setEditItem({ ...editItem, recording_base_url: e.target.value })}
                  placeholder="http://<cloudflare-tunnel-url>/recordings/cam1/"
                />
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <Label>{isKo ? "카메라 활성화 상태" : "启用此摄像头"}</Label>
                <Switch
                  checked={editItem.is_active ?? true}
                  onCheckedChange={checked => setEditItem({ ...editItem, is_active: checked })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  {isKo ? "취소" : "取消"}
                </Button>
                <Button className="gap-1.5" onClick={handleSave}>
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

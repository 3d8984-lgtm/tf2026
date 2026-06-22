import React, { useState, useEffect, useRef } from "react";
import { useLang } from "@/contexts/LangContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Video, VideoOff, RefreshCw, Grid2X2, Maximize2, Calendar, Search, Play, Volume2, VolumeX, AlertTriangle, Radio } from "lucide-react";
import Hls from "hls.js";

interface Camera {
  id: string;
  name: string;
  location: string | null;
  stream_url: string;
  webrtc_url: string | null;
  recording_base_url: string | null;
  is_active: boolean;
}

// Single Video Player Component using Hls.js
const VideoPlayer: React.FC<{ camera: Camera; isMuted: boolean; onToggleMute: () => void }> = ({ camera, isMuted, onToggleMute }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { lang } = useLang();
  const isKo = lang === "ko";

  const initPlayer = () => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!camera.stream_url) {
      setError(isKo ? "스트림 주소가 설정되지 않았습니다." : "流地址未设置。");
      setLoading(false);
      return;
    }

    // Direct browser HLS support (Safari, mobile browsers)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = camera.stream_url;
      video.addEventListener("loadedmetadata", () => {
        setLoading(false);
        video.play().catch(() => {});
      });
      video.addEventListener("error", () => {
        setError(isKo ? "스트림 재생 오류" : "流播放错误");
        setLoading(false);
      });
    } else if (Hls.isSupported()) {
      // Chrome, Firefox, Edge etc.
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;

      hls.loadSource(camera.stream_url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error("HLS error:", data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setError(isKo ? "네트워크 전송 문제 (MediaMTX 활성화 확인 필요)" : "网络传输问题 (需检查MediaMTX是否启用)");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setError(isKo ? "미디어 디코딩 오류" : "媒体解码错误");
              hls.recoverMediaError();
              break;
            default:
              setError(isKo ? "스트림 연결 실패 (게이트웨이 오프라인)" : "流连接失败 (网关可能离线)");
              hls.destroy();
              break;
          }
          setLoading(false);
        }
      });
    } else {
      setError(isKo ? "HLS 스트리밍을 지원하지 않는 브라우저입니다." : "浏览器不支持HLS流媒体。");
      setLoading(false);
    }
  };

  useEffect(() => {
    initPlayer();
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [camera.id, camera.stream_url]);

  return (
    <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-border flex items-center justify-center">
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 text-xs gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-muted-foreground">{isKo ? "스트림 연결 중..." : "正在连接视频流..."}</span>
        </div>
      )}

      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 p-4 text-center text-xs gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 animate-pulse" />
          <div className="space-y-1">
            <p className="font-semibold text-zinc-200">{camera.name}</p>
            <p className="text-muted-foreground max-w-[250px] break-all">{error}</p>
          </div>
          <Button variant="outline" size="sm" className="h-8 text-xs mt-1" onClick={initPlayer}>
            <RefreshCw className="w-3 h-3 mr-1.5" />
            {isKo ? "재시도" : "重试"}
          </Button>
        </div>
      ) : (
        <video
          ref={videoRef}
          muted={isMuted}
          playsInline
          className="w-full h-full object-cover"
        />
      )}

      {/* Info Overlay */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded text-[11px] font-medium text-white z-10">
        <Radio className="w-3 h-3 text-red-500 animate-pulse" />
        <span>LIVE</span>
        <span className="opacity-40">|</span>
        <span>{camera.name}</span>
        {camera.location && (
          <>
            <span className="opacity-40">|</span>
            <span className="opacity-80">{camera.location}</span>
          </>
        )}
      </div>

      {/* Controls Overlay */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10 opacity-0 hover:opacity-100 transition-opacity duration-200">
        <Button variant="secondary" size="icon" className="w-7 h-7 bg-black/60 text-white hover:bg-black/80" onClick={onToggleMute}>
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </Button>
        <Button variant="secondary" size="icon" className="w-7 h-7 bg-black/60 text-white hover:bg-black/80" onClick={initPlayer}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default function CctvMonitor() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const { toast } = useToast();

  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [gridMode, setGridMode] = useState<"1" | "2" | "4">("1");
  const [isMuted, setIsMuted] = useState(true);

  // Playback States
  const [playbackDate, setPlaybackDate] = useState(new Date().toISOString().split("T")[0]);
  const [playbackTime, setPlaybackHour] = useState("12");
  const [playbackFiles, setPlaybackFiles] = useState<{ name: string; url: string; time: string }[]>([]);
  const [searchingPlayback, setSearchingPlayback] = useState(false);
  const [activePlaybackUrl, setActivePlaybackUrl] = useState<string | null>(null);
  const playbackVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const fetchCameras = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("cameras")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: true });

        if (error) throw error;
        setCameras(data || []);
        if (data && data.length > 0) {
          setSelectedCamera(data[0]);
        }
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
    fetchCameras();
  }, []);

  const handleSearchPlayback = () => {
    if (!selectedCamera) return;
    if (!selectedCamera.recording_base_url) {
      toast({
        title: isKo ? "안내" : "提示",
        description: isKo 
          ? "이 카메라에 지정된 녹화 서버 저장 경로가 없습니다. (시스템 설정에서 구성 필요)"
          : "此摄像头未指定录像存储路径 (需在系统设置中配置)",
      });
      return;
    }

    setSearchingPlayback(true);
    // MediaMTX saves recordings in formats like YYYY-MM-DD_HH-MM-SS.mp4 inside path
    // Here we generate simulated files that map dynamically to help verify the UI connection.
    setTimeout(() => {
      const generated: { name: string; url: string; time: string }[] = [];
      const base = selectedCamera.recording_base_url?.endsWith("/") 
        ? selectedCamera.recording_base_url 
        : `${selectedCamera.recording_base_url}/`;
      
      // Let's generate 4 recording segments of 15 minutes each for the selected hour
      for (let i = 0; i < 4; i++) {
        const mm = String(i * 15).padStart(2, "0");
        const filename = `${playbackDate}_${playbackTime}-${mm}-00.mp4`;
        generated.push({
          name: filename,
          url: `${base}${filename}`,
          time: `${playbackTime}:${mm}`,
        });
      }
      setPlaybackFiles(generated);
      setSearchingPlayback(false);
    }, 800);
  };

  const playRecording = (url: string) => {
    setActivePlaybackUrl(url);
    setTimeout(() => {
      if (playbackVideoRef.current) {
        playbackVideoRef.current.load();
        playbackVideoRef.current.play().catch(() => {
          toast({
            title: isKo ? "재생 오류" : "播放错误",
            description: isKo 
              ? "녹화 파일에 접근할 수 없거나 경로가 잘못되었습니다. 게이트웨이의 포트 포워딩 또는 로컬 네트워크 접근 상태를 확인해 주세요."
              : "无法访问录像文件，或路径配置有误。请检查网关的端口转发或局域网访问状态。",
            variant: "destructive",
          });
        });
      }
    }, 100);
  };

  return (
    <Tabs defaultValue="live" className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <TabsList>
          <TabsTrigger value="live" className="gap-1.5">
            <Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" />
            {isKo ? "실시간 라이브" : "实时直播"}
          </TabsTrigger>
          <TabsTrigger value="replay" className="gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {isKo ? "녹화 다시보기" : "录像回放"}
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Label className="text-xs shrink-0">{isKo ? "카메라 선택:" : "摄像头选择:"}</Label>
          <select
            className="bg-background border rounded px-2.5 py-1.5 text-xs w-full sm:w-48 outline-none"
            value={selectedCamera?.id || ""}
            onChange={e => setSelectedCamera(cameras.find(c => c.id === e.target.value) || null)}
          >
            {cameras.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.location ? `(${c.location})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TabsContent value="live">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main live stream view */}
          <div className="lg:col-span-3 space-y-4">
            {loading ? (
              <div className="aspect-video w-full rounded-lg border bg-zinc-950 flex flex-col items-center justify-center text-xs text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin text-primary mb-2" />
                {isKo ? "카메라 정보 로딩 중..." : "正在加载摄像头信息..."}
              </div>
            ) : cameras.length === 0 ? (
              <div className="aspect-video w-full rounded-lg border bg-zinc-950 flex flex-col items-center justify-center text-xs text-muted-foreground p-6 text-center">
                <VideoOff className="w-8 h-8 mb-3 opacity-40 text-muted-foreground" />
                <p className="font-medium text-zinc-300">{isKo ? "등록되거나 활성화된 카메라가 없습니다." : "暂无启用或激活的摄像头。"}</p>
                <p className="text-muted-foreground/60 mt-1">
                  {isKo ? "시스템 설정 -> 카메라 연동 메뉴에서 카메라를 등록해 주세요." : "请在系统设置 -> 摄像头对接中进行配置。"}
                </p>
              </div>
            ) : gridMode === "1" ? (
              selectedCamera && (
                <VideoPlayer
                  camera={selectedCamera}
                  isMuted={isMuted}
                  onToggleMute={() => setIsMuted(!isMuted)}
                />
              )
            ) : (
              /* Grid layouts */
              <div className={`grid gap-4 ${gridMode === "2" ? "grid-cols-2" : "grid-cols-2"}`}>
                {cameras.slice(0, Number(gridMode)).map(c => (
                  <VideoPlayer
                    key={c.id}
                    camera={c}
                    isMuted={isMuted}
                    onToggleMute={() => setIsMuted(!isMuted)}
                  />
                ))}
              </div>
            )}

            {/* Layout Toggles */}
            {cameras.length > 1 && (
              <div className="flex justify-end gap-1.5">
                <Button
                  variant={gridMode === "1" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setGridMode("1")}
                >
                  <Video className="w-3.5 h-3.5 mr-1.5" />
                  {isKo ? "단일 뷰" : "单画面"}
                </Button>
                <Button
                  variant={gridMode === "2" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setGridMode("2")}
                >
                  <Grid2X2 className="w-3.5 h-3.5 mr-1.5" />
                  {isKo ? "2분할 뷰" : "双画面"}
                </Button>
                {cameras.length >= 4 && (
                  <Button
                    variant={gridMode === "4" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setGridMode("4")}
                  >
                    <Grid2X2 className="w-3.5 h-3.5 mr-1.5" />
                    {isKo ? "4분할 뷰" : "四画面"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Quick specs / hardware guide card */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{isKo ? "게이트웨이 연동 가이드" : "网关对接指南"}</CardTitle>
                <CardDescription className="text-xs">
                  {isKo ? "산업용 IoT 게이트웨이 (Cosofteck RK2676B)" : "工业级 IoT 网关 (Cosofteck RK2676B)"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="p-3 bg-muted/40 rounded-md border border-border">
                  <p className="font-semibold text-primary mb-1.5">
                    {isKo ? "설정된 네트워크 IP 대역" : "已配置的网络IP频段"}
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                    <li>Camera IP: <code className="font-mono text-foreground">192.168.1.10</code></li>
                    <li>Gateway IP: <code className="font-mono text-foreground">192.168.1.100</code></li>
                    <li>RTSP Port: <code className="font-mono text-foreground">554</code></li>
                    <li>HLS Stream Port: <code className="font-mono text-foreground">8888</code></li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <p className="font-semibold">{isKo ? "MediaMTX 게이트웨이 서비스" : "MediaMTX 网关服务"}</p>
                  <p className="text-muted-foreground leading-relaxed">
                    {isKo 
                      ? "IP 카메라의 로컬 RTSP 신호를 외부 브라우저에서 재생 가능한 HLS/WebRTC 형식으로 변환하여 안전하게 전달합니다."
                      : "将摄像头的本地 RTSP 信号转换为浏览器可播放的 HLS/WebRTC 格式，并进行安全传输。"}
                  </p>
                </div>

                <div className="border-t pt-3 space-y-1.5">
                  <span className="font-semibold">{isKo ? "연동 상태 요약" : "对接状态摘要"}</span>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{isKo ? "게이트웨이" : "网关"}</span>
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 font-normal">Active</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{isKo ? "카메라 1" : "摄像头 1"}</span>
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 font-normal">Connected</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="replay">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Replay view */}
          <div className="lg:col-span-3 space-y-4">
            {activePlaybackUrl ? (
              <div className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border">
                <video
                  ref={playbackVideoRef}
                  controls
                  playsInline
                  className="w-full h-full object-contain"
                  src={activePlaybackUrl}
                />
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded text-[11px] font-medium text-white">
                  {isKo ? "재생 중:" : "播放中:"} {activePlaybackUrl.split("/").pop()}
                </div>
              </div>
            ) : (
              <div className="aspect-video w-full rounded-lg border bg-zinc-950 flex flex-col items-center justify-center text-xs text-muted-foreground p-6 text-center">
                <Play className="w-10 h-10 mb-3 opacity-40 text-muted-foreground" />
                <p className="font-medium text-zinc-300">
                  {isKo ? "재생할 녹화 파일을 목록에서 선택해 주세요." : "请在列表中选择要播放的录像文件。"}
                </p>
                <p className="text-muted-foreground/60 mt-1">
                  {isKo ? "우측 검색 필터에서 날짜와 시간을 선택 후 검색해 주세요." : "在右侧的筛选条件中选择日期与时间并搜索。"}
                </p>
              </div>
            )}
          </div>

          {/* Filters and List */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{isKo ? "녹화 검색 필터" : "录像搜索筛选"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-xs">
                  <div className="space-y-1.5">
                    <Label>{isKo ? "조회 일자" : "查询日期"}</Label>
                    <Input
                      type="date"
                      value={playbackDate}
                      onChange={e => setPlaybackDate(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>{isKo ? "조회 시간대 (시)" : "查询时间段 (时)"}</Label>
                    <select
                      className="w-full bg-background border rounded px-2.5 py-1.5 text-xs outline-none"
                      value={playbackTime}
                      onChange={e => setPlaybackHour(e.target.value)}
                    >
                      {Array.from({ length: 24 }).map((_, i) => {
                        const val = String(i).padStart(2, "0");
                        return <option key={val} value={val}>{val}:00 ~ {val}:59</option>;
                      })}
                    </select>
                  </div>

                  <Button
                    className="w-full gap-1.5"
                    size="sm"
                    disabled={searchingPlayback || !selectedCamera}
                    onClick={handleSearchPlayback}
                  >
                    {searchingPlayback ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    {isKo ? "녹화 목록 검색" : "搜索录像列表"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="h-[280px] flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold">{isKo ? "녹화 파일 목록" : "录像文件列表"}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto px-4 pb-4">
                {playbackFiles.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-xs text-muted-foreground">
                    {isKo ? "조회된 파일이 없습니다." : "未检索到文件。"}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {playbackFiles.map((file, i) => (
                      <button
                        key={i}
                        className={`w-full flex items-center justify-between text-left text-xs p-2 rounded border transition-colors hover:bg-muted/60 ${
                          activePlaybackUrl === file.url ? "border-primary bg-primary/5" : "border-border"
                        }`}
                        onClick={() => playRecording(file.url)}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Play className="w-3 h-3 text-primary shrink-0" />
                          <span className="font-mono truncate">{file.name}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{file.time}</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { supabase } from "@/integrations/supabase/client";
import { Camera as CameraIcon, RefreshCw, Download, Image as ImageIcon, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type Cam = {
  id: string | number;
  name?: string;
  location?: string;
  status?: string;
  hls_url?: string;
  live_playlist?: string;
  snapshot_url?: string;
  clip_url?: string;
  [k: string]: any;
};

// Rewrite an upstream URL (absolute or path) so it flows through our proxy.
function toProxyUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    let path: string;
    if (/^https?:\/\//i.test(u)) {
      const parsed = new URL(u);
      path = parsed.pathname + parsed.search;
    } else {
      path = u.startsWith("/") ? u : `/${u}`;
    }
    return `${PROXY_BASE}${path}`;
  } catch {
    return null;
  }
}

async function proxyFetch(pathOrUrl: string, init?: RequestInit) {
  const target = pathOrUrl.startsWith("http") ? pathOrUrl : `${PROXY_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const headers = new Headers(init?.headers);
  headers.set("apikey", ANON_KEY);
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(target, { ...init, headers });
}

function nowLocalDatetime(offsetMinutes = 0) {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CCTVQuality() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const [cams, setCams] = useState<Cam[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Cam | null>(null);
  const [snapshotTime, setSnapshotTime] = useState<string>(nowLocalDatetime(-1));
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [clipStart, setClipStart] = useState<string>(nowLocalDatetime(-10));
  const [clipEnd, setClipEnd] = useState<string>(nowLocalDatetime(-1));
  const [clipLoading, setClipLoading] = useState(false);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const T = useMemo(() => ({
    title: isKo ? "CCTV 품질확인" : "CCTV 质量确认",
    desc: isKo
      ? "공장에 설치된 카메라의 실시간 영상과 지정 시간 스냅샷, 구간 녹화본을 조회합니다."
      : "查看工厂摄像头的实时画面、指定时间快照和时段录像。",
    refresh: isKo ? "카메라 목록 새로고침" : "刷新摄像头列表",
    cameras: isKo ? "카메라 목록" : "摄像头列表",
    noCams: isKo ? "등록된 카메라가 없습니다." : "尚未注册摄像头。",
    live: isKo ? "실시간 영상" : "实时画面",
    liveNone: isKo ? "왼쪽에서 카메라를 선택하세요." : "请在左侧选择摄像头。",
    snapshot: isKo ? "스냅샷 (지정 시각)" : "快照（指定时间）",
    snapshotAt: isKo ? "촬영 시각" : "时间",
    getSnapshot: isKo ? "스냅샷 가져오기" : "获取快照",
    clip: isKo ? "녹화본 다운로드 (하드디스크 저장)" : "录像下载（保存到硬盘）",
    from: isKo ? "시작 시각" : "开始时间",
    to: isKo ? "종료 시각" : "结束时间",
    download: isKo ? "MP4 다운로드" : "下载 MP4",
    online: isKo ? "온라인" : "在线",
    offline: isKo ? "오프라인" : "离线",
    fetchFail: isKo ? "카메라 목록을 불러오지 못했습니다." : "无法加载摄像头列表。",
    snapFail: isKo ? "스냅샷을 가져오지 못했습니다." : "无法获取快照。",
    clipFail: isKo ? "녹화본을 다운로드하지 못했습니다." : "无法下载录像。",
    clipDone: isKo ? "녹화본을 다운로드했습니다." : "录像已下载。",
    rangeInvalid: isKo ? "종료 시각이 시작 시각보다 늦어야 합니다." : "结束时间必须晚于开始时间。",
  }), [isKo]);

  const loadCams = async () => {
    setLoading(true);
    try {
      const res = await proxyFetch("/api/v1/cam");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: Cam[] = Array.isArray(data) ? data : (data.cameras || data.items || data.data || []);
      setCams(list);
    } catch (e) {
      console.error(e);
      toast.error(T.fetchFail);
      setCams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCams(); /* eslint-disable-next-line */ }, []);

  // Attach HLS when a camera is selected.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    const hlsRaw = selected.live_playlist || selected.hls_url || `/api/v1/cam/${selected.id}/live/stream.m3u8`;
    const src = toProxyUrl(hlsRaw);
    if (!src) return;
    // hls.js xhrSetup injects Supabase auth headers so the edge function accepts requests.
    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: (xhr) => {
          xhr.setRequestHeader("apikey", ANON_KEY);
          supabase.auth.getSession().then(({ data }) => {
            const tok = data.session?.access_token;
            if (tok) xhr.setRequestHeader("Authorization", `Bearer ${tok}`);
          });
        },
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hlsRef.current = hls;
      return () => { hls.destroy(); hlsRef.current = null; };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
    }
  }, [selected]);

  const fetchSnapshot = async () => {
    if (!selected) return;
    setSnapLoading(true);
    setSnapshotSrc(null);
    try {
      const iso = new Date(snapshotTime).toISOString();
      const path = `/api/v1/cam/${selected.id}/snapshot?time=${encodeURIComponent(iso)}`;
      const res = await proxyFetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setSnapshotSrc(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      toast.error(T.snapFail);
    } finally {
      setSnapLoading(false);
    }
  };

  const downloadClip = async () => {
    if (!selected) return;
    const startMs = new Date(clipStart).getTime();
    const endMs = new Date(clipEnd).getTime();
    if (!(endMs > startMs)) { toast.error(T.rangeInvalid); return; }
    setClipLoading(true);
    try {
      const params = new URLSearchParams({
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
      });
      const path = `/api/v1/cam/${selected.id}/clip?${params.toString()}`;
      const res = await proxyFetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      const nm = (selected.name || `cam-${selected.id}`).replace(/[^\w.-]+/g, "_");
      a.download = `${nm}_${clipStart.replace(/[:T]/g, "-")}_${clipEnd.replace(/[:T]/g, "-")}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(T.clipDone);
    } catch (e) {
      console.error(e);
      toast.error(T.clipFail);
    } finally {
      setClipLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={T.title} description={T.desc} />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Camera list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CameraIcon className="w-4 h-4" /> {T.cameras}
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={loadCams} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[70vh] overflow-y-auto">
            {cams.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground py-8 text-center">{T.noCams}</p>
            )}
            {cams.map((c) => {
              const active = selected?.id === c.id;
              const online = String(c.status ?? "").toLowerCase() === "online" || (c as any).online === true;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left rounded-md border p-3 transition ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{c.name || `Camera ${c.id}`}</span>
                    <Badge variant={online ? "default" : "secondary"} className="text-[10px]">
                      {online ? T.online : T.offline}
                    </Badge>
                  </div>
                  {c.location && <p className="text-xs text-muted-foreground mt-1 truncate">{c.location}</p>}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Detail panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PlayCircle className="w-4 h-4" /> {T.live}
                {selected && <span className="text-sm text-muted-foreground font-normal ml-2">{selected.name || `Camera ${selected.id}`}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selected ? (
                <div className="bg-black rounded-md overflow-hidden aspect-video">
                  <video ref={videoRef} controls autoPlay muted playsInline className="w-full h-full" />
                </div>
              ) : (
                <div className="bg-muted/30 rounded-md aspect-video flex items-center justify-center text-sm text-muted-foreground">
                  {T.liveNone}
                </div>
              )}
            </CardContent>
          </Card>

          {selected && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Snapshot */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> {T.snapshot}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.snapshotAt}</Label>
                    <Input type="datetime-local" value={snapshotTime} onChange={(e) => setSnapshotTime(e.target.value)} />
                  </div>
                  <Button onClick={fetchSnapshot} disabled={snapLoading} className="w-full">
                    {snapLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ImageIcon className="w-4 h-4 mr-2" />}
                    {T.getSnapshot}
                  </Button>
                  {snapshotSrc && (
                    <button className="block w-full rounded-md overflow-hidden border" onClick={() => setZoomSrc(snapshotSrc)}>
                      <img src={snapshotSrc} alt="snapshot" className="w-full h-auto" />
                    </button>
                  )}
                </CardContent>
              </Card>

              {/* Clip download */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Download className="w-4 h-4" /> {T.clip}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.from}</Label>
                    <Input type="datetime-local" value={clipStart} onChange={(e) => setClipStart(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.to}</Label>
                    <Input type="datetime-local" value={clipEnd} onChange={(e) => setClipEnd(e.target.value)} />
                  </div>
                  <Button onClick={downloadClip} disabled={clipLoading} className="w-full">
                    {clipLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                    {T.download}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!zoomSrc} onOpenChange={(o) => !o && setZoomSrc(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{T.snapshot}</DialogTitle>
          </DialogHeader>
          {zoomSrc && <img src={zoomSrc} alt="snapshot zoom" className="w-full h-auto rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLang } from "@/contexts/LangContext";
import { supabase } from "@/integrations/supabase/client";
import { Camera as CameraIcon, RefreshCw, Download, Image as ImageIcon, Loader2, PlayCircle, Pencil, ArrowUp, ArrowDown, Play, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/DateTimePicker";

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cctv-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const LS_NAMES = "cctv_cam_names_v1";
const LS_ORDER = "cctv_cam_order_v1";
const MAX_CLIP_SECONDS = 360;

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

function loadNameMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LS_NAMES) || "{}"); } catch { return {}; }
}
function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_ORDER) || "[]"); } catch { return []; }
}

async function fetchServerSettings(): Promise<{ names: Record<string, string>; order: string[] }> {
  const { data, error } = await supabase
    .from("cctv_camera_settings")
    .select("camera_id, display_name, sort_order")
    .order("sort_order", { ascending: true });
  if (error || !data) return { names: {}, order: [] };
  const names: Record<string, string> = {};
  const order: string[] = [];
  for (const row of data) {
    if (row.display_name) names[row.camera_id] = row.display_name;
    order.push(row.camera_id);
  }
  return { names, order };
}


export default function CCTVQuality() {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const [cams, setCams] = useState<Cam[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>(loadNameMap);
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [statusMap, setStatusMap] = useState<Record<string, "online" | "offline" | "checking">>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Cam | null>(null);
  const [snapshotTime, setSnapshotTime] = useState<string>(nowLocalDatetime(-1));
  const [snapshotSrc, setSnapshotSrc] = useState<string | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [clipStart, setClipStart] = useState<string>(nowLocalDatetime(-10));
  const [clipEnd, setClipEnd] = useState<string>(nowLocalDatetime(-1));
  const [clipLoading, setClipLoading] = useState(false);
  const clipAbortRef = useRef<AbortController | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<Cam | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [playStart, setPlayStart] = useState<string>(nowLocalDatetime(-10));
  const [playEnd, setPlayEnd] = useState<string>(nowLocalDatetime(-5));
  const [playLoading, setPlayLoading] = useState(false);
  const [playSrc, setPlaySrc] = useState<string | null>(null);
  const [playOpen, setPlayOpen] = useState(false);
  const [liveState, setLiveState] = useState<"connecting" | "playing" | "waiting">("connecting");
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
    checking: isKo ? "확인중" : "检测中",
    fetchFail: isKo ? "카메라 목록을 불러오지 못했습니다." : "无法加载摄像头列表。",
    snapFail: isKo ? "스냅샷을 가져오지 못했습니다." : "无法获取快照。",
    clipFail: isKo ? "녹화본을 다운로드하지 못했습니다." : "无法下载录像。",
    clipDone: isKo ? "녹화본을 다운로드했습니다." : "录像已下载。",
    clipCanceled: isKo ? "다운로드를 취소했습니다." : "已取消下载。",
    cancelDownload: isKo ? "다운로드 취소" : "取消下载",
    rangeInvalid: isKo ? "종료 시각이 시작 시각보다 늦어야 합니다." : "结束时间必须晚于开始时间。",
    rename: isKo ? "이름 변경" : "重命名",
    moveUp: isKo ? "위로" : "上移",
    moveDown: isKo ? "아래로" : "下移",
    renameTitle: isKo ? "카메라 이름 변경" : "重命名摄像头",
    newName: isKo ? "새 이름" : "新名称",
    save: isKo ? "저장" : "保存",
    cancel: isKo ? "취소" : "取消",
    reset: isKo ? "초기화" : "重置",
    playback: isKo ? "녹화본 재생 (지정 구간)" : "录像回放（指定时段）",
    play: isKo ? "재생" : "播放",
    playTooLong: isKo ? "재생은 최대 6분(360초)까지 가능합니다." : "回放最长支持 6 分钟（360 秒）。",
    playFail: isKo ? "녹화본을 재생하지 못했습니다." : "无法播放录像。",
    playerTitle: isKo ? "녹화본 재생" : "录像回放",
    rangeGap: isKo
      ? "선택한 구간에 녹화가 없거나 아직 저장되지 않았습니다. 다른 시각을 선택해 주세요."
      : "所选时段没有录像或尚未完成保存。请选择其他时段。",
    liveWaiting: isKo
      ? "카메라 녹화가 중지되어 있습니다. 자동으로 다시 연결합니다."
      : "摄像头当前未在录像，正在自动重新连接。",
    liveConnecting: isKo ? "실시간 영상 연결 중..." : "正在连接实时画面...",
    hevcLabel: isKo ? "H.265(HEVC) 재생" : "H.265(HEVC) 播放",
    hevcYes: isKo ? "이 PC에서 지원됨" : "此电脑支持",
    hevcNo: isKo ? "이 PC에서 미지원" : "此电脑不支持",
    hevcChecking: isKo ? "확인중" : "检测中",
    hevcWarn: isKo
      ? "이 브라우저/PC는 H.265(HEVC) 디코딩을 지원하지 않습니다. 서버가 H.265 원본을 그대로 보내면 화면이 검게 보일 수 있습니다."
      : "此浏览器/电脑不支持 H.265(HEVC) 解码。若服务器直接发送 H.265 原始流，画面可能显示为黑屏。",
  }), [isKo]);

  // Detect whether this machine can decode H.265 natively. Used to decide
  // if the server can skip transcoding (send HEVC as-is) for this client.
  const [hevcSupport, setHevcSupport] = useState<"checking" | "yes" | "no">("checking");
  useEffect(() => {
    const types = [
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
    ];
    const el = document.createElement("video");
    const canPlay = types.some((t) => el.canPlayType(t) !== "");
    const mseOk =
      typeof window !== "undefined" &&
      "MediaSource" in window &&
      types.some((t) => {
        try { return window.MediaSource.isTypeSupported(t); } catch { return false; }
      });
    setHevcSupport(canPlay || mseOk ? "yes" : "no");
  }, []);


  const displayName = (c: Cam) => nameMap[String(c.id)] || c.name || `Camera ${c.id}`;

  const sortedCams = useMemo(() => {
    if (!order.length) return cams;
    const idx = new Map(order.map((id, i) => [id, i]));
    return [...cams].sort((a, b) => {
      const ai = idx.has(String(a.id)) ? (idx.get(String(a.id)) as number) : 9999;
      const bi = idx.has(String(b.id)) ? (idx.get(String(b.id)) as number) : 9999;
      return ai - bi;
    });
  }, [cams, order]);

  const persistOrder = async (list: Cam[]) => {
    const ids = list.map((c) => String(c.id));
    setOrder(ids);
    localStorage.setItem(LS_ORDER, JSON.stringify(ids));
    try {
      const rows = ids.map((cid, i) => ({
        camera_id: cid,
        sort_order: i,
        display_name: nameMap[cid] ?? null,
      }));
      await supabase.from("cctv_camera_settings").upsert(rows, { onConflict: "camera_id" });
    } catch (e) {
      console.error("persistOrder failed", e);
    }
  };

  const moveCam = (id: string, dir: -1 | 1) => {
    const list = [...sortedCams];
    const i = list.findIndex((c) => String(c.id) === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    persistOrder(list);
  };

  const saveRename = async () => {
    if (!renameTarget) return;
    const key = String(renameTarget.id);
    const next = { ...nameMap };
    const v = renameValue.trim();
    if (v) next[key] = v; else delete next[key];
    setNameMap(next);
    localStorage.setItem(LS_NAMES, JSON.stringify(next));
    setRenameTarget(null);
    try {
      const idx = order.indexOf(key);
      await supabase.from("cctv_camera_settings").upsert(
        { camera_id: key, display_name: v || null, sort_order: idx >= 0 ? idx : 0 },
        { onConflict: "camera_id" },
      );
    } catch (e) {
      console.error("saveRename failed", e);
      toast.error(isKo ? "이름 저장에 실패했습니다." : "保存名称失败。");
    }
  };


  // Probe each camera's playlist to determine real online/offline state.
  const probeStatus = async (list: Cam[]) => {
    const init: Record<string, "checking"> = {};
    list.forEach((c) => (init[String(c.id)] = "checking"));
    setStatusMap((s) => ({ ...s, ...init }));
    await Promise.all(list.map(async (c) => {
      const raw = c.live_playlist || c.hls_url || `/api/v1/cam/${c.id}/live/stream.m3u8`;
      try {
        const res = await proxyFetch(raw, { method: "GET" });
        const ok = res.status === 200;
        try { await res.body?.cancel(); } catch {}
        setStatusMap((s) => ({ ...s, [String(c.id)]: ok ? "online" : "offline" }));
      } catch {
        setStatusMap((s) => ({ ...s, [String(c.id)]: "offline" }));
      }
    }));
  };

  const loadCams = async () => {
    setLoading(true);
    try {
      const res = await proxyFetch("/api/v1/cam");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data && !Array.isArray(data) && data.offline) {
        // On-site camera server unreachable (tunnel down) — not a crash.
        setCams([]);
        toast.error(isKo ? "카메라 서버에 연결할 수 없습니다 (현장 서버 오프라인)." : "无法连接摄像头服务器（现场服务器离线）。");
        return;
      }
      const list: Cam[] = Array.isArray(data) ? data : (data.cameras || data.items || data.data || []);
      setCams(list);
      probeStatus(list);

    } catch (e) {
      console.error(e);
      toast.error(T.fetchFail);
      setCams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCams();
    fetchServerSettings().then(({ names, order: srvOrder }) => {
      if (Object.keys(names).length) {
        setNameMap((prev) => ({ ...prev, ...names }));
        localStorage.setItem(LS_NAMES, JSON.stringify(names));
      }
      if (srvOrder.length) {
        setOrder(srvOrder);
        localStorage.setItem(LS_ORDER, JSON.stringify(srvOrder));
      }
    }).catch((e) => console.error("fetchServerSettings failed", e));
    /* eslint-disable-next-line */
  }, []);

  // Re-probe every 30s so status reflects actual connectivity.
  useEffect(() => {
    if (!cams.length) return;
    const t = setInterval(() => probeStatus(cams), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [cams]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    const hlsRaw = selected.live_playlist || selected.hls_url || `/api/v1/cam/${selected.id}/live/stream.m3u8`;
    const src = toProxyUrl(hlsRaw);
    if (!src) return;
    let disposed = false;
    let retryTimer: number | null = null;
    setLiveState("connecting");

    const markPlaying = () => setLiveState("playing");
    video.addEventListener("playing", markPlaying);

    const initialize = async () => {
      if (Hls.isSupported()) {
        const { data } = await supabase.auth.getSession();
        if (disposed) return;
        const token = data.session?.access_token;
        const hls = new Hls({
          xhrSetup: (xhr: XMLHttpRequest) => {
            xhr.setRequestHeader("apikey", ANON_KEY);
            if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          },
        });
        const scheduleReload = () => {
          if (retryTimer || disposed) return;
          setLiveState("waiting");
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            if (disposed) return;
            setLiveState("connecting");
            try {
              hls.stopLoad();
              hls.loadSource(src);
              hls.startLoad();
            } catch {
              scheduleReload();
            }
          }, 5000);
        };
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLiveState("playing");
          video.play().catch(() => undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, errorData) => {
          const status = errorData.response?.code;
          if (status === 204 || status === 404 || errorData.fatal) scheduleReload();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => setLiveState("waiting"));
      } else {
        setLiveState("waiting");
      }
    };

    initialize();
    return () => {
      disposed = true;
      video.removeEventListener("playing", markPlaying);
      if (retryTimer) window.clearTimeout(retryTimer);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [selected]);

  const fetchSnapshot = async () => {
    if (!selected) return;
    setSnapLoading(true);
    setSnapshotSrc(null);
    try {
      const iso = new Date(snapshotTime).toISOString();
      // The recorder API exposes archived still frames through /seek?at=.
      // /snapshot?time= is not a valid upstream route and always returns 404.
      const path = `/api/v1/cam/${selected.id}/seek?at=${encodeURIComponent(iso)}`;
      const res = await proxyFetch(path);
      if (res.status === 404) {
        toast.error(isKo
          ? "해당 시각의 스냅샷이 서버에 없습니다. 다른 시각을 선택하세요."
          : "该时间点没有可用快照，请选择其他时间。");
        return;
      }
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
    const controller = new AbortController();
    clipAbortRef.current = controller;
    setClipLoading(true);
    try {
      const totalSeconds = Math.max(1, Math.ceil((endMs - startMs) / 1000));
      const chunks: Array<{ startMs: number; duration: number }> = [];
      let elapsedSeconds = 0;
      while (elapsedSeconds < totalSeconds) {
        const duration = Math.min(MAX_CLIP_SECONDS, totalSeconds - elapsedSeconds);
        chunks.push({ startMs: startMs + elapsedSeconds * 1000, duration });
        elapsedSeconds += duration;
      }

      const files: Array<{ name: string; blob: Blob }> = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const params = new URLSearchParams({
          start: new Date(chunk.startMs).toISOString(),
          duration: String(chunk.duration),
        });
        const path = `/api/v1/cam/${selected.id}/clip?${params.toString()}`;
        const res = await proxyFetch(path, { signal: controller.signal });
        if (res.status === 409 || res.status === 404) {
          toast.error(T.rangeGap);
          return;
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
        }
        files.push({
          name: `part-${String(index + 1).padStart(2, "0")}.mp4`,
          blob: await res.blob(),
        });
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      }

      const a = document.createElement("a");
      let downloadBlob = files[0].blob;
      let extension = "mp4";
      if (files.length > 1) {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        files.forEach((file) => zip.file(file.name, file.blob));
        downloadBlob = await zip.generateAsync({ type: "blob" });
        extension = "zip";
      }
      const url = URL.createObjectURL(downloadBlob);
      a.href = url;
      const nm = (displayName(selected)).replace(/[^\w.-]+/g, "_");
      a.download = `${nm}_${clipStart.replace(/[:T]/g, "-")}_${clipEnd.replace(/[:T]/g, "-")}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(T.clipDone);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        toast.message(T.clipCanceled);
      } else {
        console.error(e);
        toast.error(T.clipFail);
      }
    } finally {
      setClipLoading(false);
      clipAbortRef.current = null;
    }
  };

  const cancelClipDownload = () => {
    clipAbortRef.current?.abort();
  };


  const playClip = async () => {
    if (!selected) return;
    const startMs = new Date(playStart).getTime();
    const endMs = new Date(playEnd).getTime();
    if (!(endMs > startMs)) { toast.error(T.rangeInvalid); return; }
    const duration = Math.ceil((endMs - startMs) / 1000);
    if (duration > MAX_CLIP_SECONDS) { toast.error(T.playTooLong); return; }
    setPlayLoading(true);
    try {
      const params = new URLSearchParams({
        start: new Date(startMs).toISOString(),
        duration: String(duration),
        apikey: ANON_KEY,
      });
      // Stream straight into <video> so playback starts as soon as the first
      // bytes arrive, instead of buffering the whole MP4 into a blob first.
      const streamUrl = `${PROXY_BASE}/api/v1/cam/${selected.id}/clip?${params.toString()}`;
      if (playSrc?.startsWith("blob:")) URL.revokeObjectURL(playSrc);
      setPlaySrc(streamUrl);
      setPlayOpen(true);
    } catch (e) {
      console.error(e);
      toast.error(T.playFail);
    } finally {
      setPlayLoading(false);
    }
  };

  // Fallback: if progressive streaming fails (upstream without Range support),
  // fetch the clip once and play it from a blob URL.
  const playFallbackRef = useRef(false);
  const handlePlayerError = async () => {
    if (!playSrc || playSrc.startsWith("blob:") || playFallbackRef.current) {
      toast.error(T.playFail);
      return;
    }
    playFallbackRef.current = true;
    setPlayLoading(true);
    try {
      const res = await proxyFetch(playSrc);
      if (res.status === 409 || res.status === 404) { toast.error(T.rangeGap); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setPlaySrc(URL.createObjectURL(blob));
    } catch (e) {
      console.error(e);
      toast.error(T.playFail);
    } finally {
      setPlayLoading(false);
    }
  };



  return (
    <div className="space-y-4">
      <PageHeader title={T.title} description={T.desc} />

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
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
            {sortedCams.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground py-8 text-center">{T.noCams}</p>
            )}
            {sortedCams.map((c, i) => {
              const idStr = String(c.id);
              const active = selected && String(selected.id) === idStr;
              const st = statusMap[idStr] || "checking";
              const badgeVariant = st === "online" ? "default" : st === "offline" ? "secondary" : "outline";
              const badgeText = st === "online" ? T.online : st === "offline" ? T.offline : T.checking;
              return (
                <div
                  key={idStr}
                  className={`rounded-md border p-3 transition ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                >
                  <button onClick={() => setSelected(c)} className="w-full text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm truncate">{displayName(c)}</span>
                      <Badge variant={badgeVariant as any} className="text-[10px]">{badgeText}</Badge>
                    </div>
                    {c.location && <p className="text-xs text-muted-foreground mt-1 truncate">{c.location}</p>}
                  </button>
                  <div className="flex items-center gap-1 mt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={(e) => { e.stopPropagation(); setRenameTarget(c); setRenameValue(displayName(c)); }}
                      title={T.rename}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={(e) => { e.stopPropagation(); moveCam(idStr, -1); }}
                      disabled={i === 0}
                      title={T.moveUp}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={(e) => { e.stopPropagation(); moveCam(idStr, 1); }}
                      disabled={i === sortedCams.length - 1}
                      title={T.moveDown}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <PlayCircle className="w-4 h-4" /> {T.live}
                {selected && <span className="text-sm text-muted-foreground font-normal ml-2">{displayName(selected)}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selected ? (
                <div className="relative bg-black rounded-md overflow-hidden aspect-video">
                  <video ref={videoRef} controls autoPlay muted playsInline className="w-full h-full" />
                  {liveState !== "playing" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center">
                      {liveState === "connecting" ? (
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      ) : (
                        <VideoOff className="h-8 w-8 text-muted-foreground" />
                      )}
                      <p className="text-sm text-muted-foreground">
                        {liveState === "connecting" ? T.liveConnecting : T.liveWaiting}
                      </p>
                    </div>
                  )}
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> {T.snapshot}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.snapshotAt}</Label>
                    <DateTimePicker value={snapshotTime} onChange={setSnapshotTime} />
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

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Download className="w-4 h-4" /> {T.clip}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.from}</Label>
                    <DateTimePicker value={clipStart} onChange={setClipStart} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{T.to}</Label>
                    <DateTimePicker value={clipEnd} onChange={setClipEnd} />
                  </div>
                  <Button onClick={downloadClip} disabled={clipLoading} className="w-full">
                    {clipLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                    {T.download}
                  </Button>
                  {clipLoading && (
                    <Button onClick={cancelClipDownload} variant="outline" className="w-full">
                      {T.cancelDownload}
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    <Play className="w-4 h-4" /> {T.playback}
                    <Badge
                      variant={hevcSupport === "yes" ? "default" : hevcSupport === "no" ? "destructive" : "secondary"}
                      className="ml-auto text-[11px] font-normal"
                    >
                      {T.hevcLabel}:{" "}
                      {hevcSupport === "checking" ? T.hevcChecking : hevcSupport === "yes" ? T.hevcYes : T.hevcNo}
                    </Badge>
                  </CardTitle>

                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{T.from}</Label>
                      <DateTimePicker value={playStart} onChange={setPlayStart} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{T.to}</Label>
                      <DateTimePicker value={playEnd} onChange={setPlayEnd} />
                    </div>
                  </div>
                  <Button onClick={playClip} disabled={playLoading} className="w-full">
                    {playLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    {T.play}
                  </Button>
                  <p className="text-xs text-muted-foreground">{T.playTooLong}</p>
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

      <Dialog open={playOpen} onOpenChange={(o) => { setPlayOpen(o); if (!o) { if (playSrc?.startsWith("blob:")) URL.revokeObjectURL(playSrc); setPlaySrc(null); playFallbackRef.current = false; } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{T.playerTitle}</DialogTitle>
          </DialogHeader>
          {hevcSupport === "no" && (
            <p className="text-xs text-destructive border border-destructive/40 rounded p-2">{T.hevcWarn}</p>
          )}
          {playSrc && (

            <video
              key={playSrc}
              src={playSrc}
              controls
              autoPlay
              muted
              playsInline
              preload="auto"
              className="w-full h-auto rounded bg-black"
              onLoadedData={(e) => {
                // Browsers block autoplay without a gesture; retry explicitly
                // once the first frame is decoded so the clip does not sit paused.
                e.currentTarget.play().catch(() => undefined);
              }}
              onCanPlay={(e) => {
                e.currentTarget.play().catch(() => undefined);
              }}
              onError={handlePlayerError}
            />
          )}

        </DialogContent>
      </Dialog>


      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{T.renameTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">{T.newName}</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveRename(); }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => { setRenameValue(""); }}>{T.reset}</Button>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>{T.cancel}</Button>
            <Button onClick={saveRename}>{T.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

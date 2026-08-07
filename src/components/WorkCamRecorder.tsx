import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff, Circle, Loader2, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";

interface Props {
  /** When true, a recording session is active. Flipping to false stops and emits the blob. */
  recording: boolean;
  onRecorded: (blob: Blob) => void;
  uploading?: boolean;
}

const STORAGE_KEY = "workcam.deviceId";

/** Built-in tablet/phone cameras usually expose a facingMode; USB webcams do not. */
function isLikelyBuiltIn(d: MediaDeviceInfo) {
  const l = (d.label || "").toLowerCase();
  return /front|back|rear|facing|전면|후면|前置|后置/.test(l);
}

/**
 * USB (or built-in) camera preview for the t-shirt attach workstation.
 * The operator can pick which camera to use; the choice is remembered per device.
 * Recording is driven by the scan flow: it starts with the first scan and
 * stops once the last sticker code is verified.
 */
export default function WorkCamRecorder({ recording, onRecorded, uploading }: Props) {
  const { lang } = useLang();
  const isKo = lang === "ko";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const onRecordedRef = useRef(onRecorded);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isRec, setIsRec] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || "");

  useEffect(() => { onRecordedRef.current = onRecorded; }, [onRecorded]);

  const listDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === "videoinput");
      setDevices(cams);
      return cams;
    } catch {
      return [] as MediaDeviceInfo[];
    }
  }, []);

  const start = useCallback(async (wanted?: string) => {
    setError(null);
    setReady(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    try {
      // First permission grant (labels are empty until then).
      let cams = await listDevices();
      if (cams.length === 0 || !cams[0].label) {
        const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        probe.getTracks().forEach(t => t.stop());
        cams = await listDevices();
      }

      let target = wanted && cams.some(c => c.deviceId === wanted) ? wanted : "";
      if (!target) {
        // Prefer an external (USB) camera over the tablet's built-in one.
        const usb = cams.find(c => !isLikelyBuiltIn(c));
        target = (usb || cams[0])?.deviceId || "";
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: target
          ? { deviceId: { exact: target }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const actual = stream.getVideoTracks()[0]?.getSettings().deviceId || target;
      if (actual) {
        setDeviceId(actual);
        localStorage.setItem(STORAGE_KEY, actual);
      }
      setReady(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, [listDevices]);

  // Acquire the camera once.
  useEffect(() => {
    start(localStorage.getItem(STORAGE_KEY) || undefined);
    const onChange = () => { listDevices(); };
    navigator.mediaDevices.addEventListener?.("devicechange", onChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.("devicechange", onChange);
      try { recorderRef.current?.state === "recording" && recorderRef.current.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start/stop recording following the scan flow.
  useEffect(() => {
    if (!ready || !streamRef.current) return;

    if (recording && !recorderRef.current) {
      try {
        const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
          .find(m => MediaRecorder.isTypeSupported(m)) || "";
        const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
        chunksRef.current = [];
        rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          chunksRef.current = [];
          if (blob.size > 0) onRecordedRef.current(blob);
        };
        rec.start(1000);
        recorderRef.current = rec;
        setIsRec(true);
        setElapsed(0);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    }

    if (!recording && recorderRef.current) {
      try { if (recorderRef.current.state !== "inactive") recorderRef.current.stop(); } catch { /* noop */ }
      recorderRef.current = null;
      setIsRec(false);
    }
  }, [recording, ready]);

  useEffect(() => {
    if (!isRec) return;
    const id = window.setInterval(() => setElapsed(e => e + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRec]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="kpi-card">
      <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Camera className="w-4 h-4" /> {isKo ? "작업 카메라" : "作业摄像头"}
        {isRec && (
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-destructive">
            <Circle className="w-2.5 h-2.5 fill-current animate-pulse" /> REC {mmss}
          </span>
        )}
        {!isRec && uploading && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {isKo ? "영상 저장 중" : "视频保存中"}
          </span>
        )}
      </h3>

      <div className="flex items-center gap-2 mb-2">
        <Select
          value={deviceId}
          onValueChange={(v) => { localStorage.setItem(STORAGE_KEY, v); setDeviceId(v); start(v); }}
          disabled={isRec}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={isKo ? "카메라 선택" : "选择摄像头"} />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d, i) => (
              <SelectItem key={d.deviceId || i} value={d.deviceId || `cam-${i}`} className="text-xs">
                {d.label || `${isKo ? "카메라" : "摄像头"} ${i + 1}`}
                {isLikelyBuiltIn(d) ? (isKo ? " (내장)" : " (内置)") : " (USB)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 px-2" disabled={isRec} onClick={() => start(deviceId || undefined)}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className={`relative rounded-lg overflow-hidden bg-muted/40 border-2 transition-colors ${isRec ? "border-destructive" : "border-border"}`}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video object-cover bg-black" />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-center p-4">
            <CameraOff className="w-8 h-8 text-muted-foreground opacity-50" />
            <p className="text-xs text-muted-foreground">
              {isKo ? "카메라를 사용할 수 없습니다" : "无法使用摄像头"}
            </p>
            <p className="text-[10px] text-muted-foreground/70 break-all max-w-xs">{error}</p>
            <Button size="sm" variant="outline" onClick={() => start()}>
              {isKo ? "다시 시도" : "重试"}
            </Button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        {isKo
          ? "USB 카메라를 우선 선택합니다. 목록에서 카메라를 바꾸면 다음 접속에도 유지됩니다."
          : "优先选择 USB 摄像头。在列表中切换后会记住该选择。"}
      </p>
    </div>
  );
}

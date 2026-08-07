import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CameraOff, Circle, Loader2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

interface Props {
  /** When true, a recording session is active. Flipping to false stops and emits the blob. */
  recording: boolean;
  onRecorded: (blob: Blob) => void;
  uploading?: boolean;
}

/**
 * USB (or built-in) camera preview for the t-shirt attach workstation.
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

  useEffect(() => { onRecordedRef.current = onRecorded; }, [onRecorded]);

  // Acquire the camera once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
    return () => {
      cancelled = true;
      try { recorderRef.current?.state === "recording" && recorderRef.current.stop(); } catch { /* noop */ }
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
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
      <div className={`relative rounded-lg overflow-hidden bg-muted/40 border-2 transition-colors ${isRec ? "border-destructive" : "border-border"}`}>
        <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video object-cover bg-black" />
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90 text-center p-4">
            <CameraOff className="w-8 h-8 text-muted-foreground opacity-50" />
            <p className="text-xs text-muted-foreground">
              {isKo ? "카메라를 사용할 수 없습니다" : "无法使用摄像头"}
            </p>
            <p className="text-[10px] text-muted-foreground/70 break-all max-w-xs">{error}</p>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              {isKo ? "다시 시도" : "重试"}
            </Button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        {isKo
          ? "첫 스캔 시 녹화가 시작되고, 스티커 고유번호 스캔이 끝나면 자동 저장됩니다."
          : "首次扫描时开始录制，扫描完贴纸唯一编号后自动保存。"}
      </p>
    </div>
  );
}

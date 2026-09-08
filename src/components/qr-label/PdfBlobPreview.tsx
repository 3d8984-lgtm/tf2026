import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore pdfjs worker is provided by Vite's worker loader
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

(pdfjsLib as any).GlobalWorkerOptions.workerPort = new PdfWorker();

export default function PdfBlobPreview({ blob }: { blob: Blob | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!blob) return;
    let active = true;
    setError("");
    void (async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const document = await (pdfjsLib as any).getDocument({ data: bytes.slice(0) }).promise;
        const page = await document.getPage(1);
        const unitViewport = page.getViewport({ scale: 1 });
        const maxWidth = Math.max(320, Math.min(900, window.innerWidth - 160));
        const viewport = page.getViewport({ scale: Math.max(1, (maxWidth * 1.5) / unitViewport.width) });
        const canvas = canvasRef.current;
        if (!active || !canvas) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas unavailable");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvasContext: context, viewport, canvas, background: "#ffffff" } as any).promise;
      } catch (cause: unknown) {
        if (active) setError(String((cause as Error)?.message ?? cause));
      }
    })();
    return () => { active = false; };
  }, [blob]);

  if (error) return <div className="p-3 text-sm text-destructive">{error}</div>;
  return (
    <div className="h-full min-h-0 overflow-auto rounded-md border bg-muted/30 p-3">
      {!blob && <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      <canvas ref={canvasRef} className="mx-auto max-w-full h-auto bg-background shadow-sm" />
    </div>
  );
}
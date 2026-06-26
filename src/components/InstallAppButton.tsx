import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "twinmeta_install_dismissed_at";
const DISMISS_DAYS = 3;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
}

function isMobile() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (!isMobile()) return;

    // Hide if user dismissed recently
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissed && Date.now() - dismissed < DISMISS_DAYS * 86400_000) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Show on iOS (no beforeinstallprompt support) right away
    if (isIOS()) setVisible(true);

    const installed = () => setVisible(false);
    window.addEventListener("appinstalled", installed);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  if (!visible) return null;

  const onInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setVisible(false);
      setDeferred(null);
    } else if (isIOS()) {
      setShowIosGuide(true);
    }
  };

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <>
      <div
        className="fixed left-2 right-2 z-50 flex items-center gap-2 rounded-xl border border-primary/40 bg-background/95 px-3 py-2 shadow-lg backdrop-blur md:hidden"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">앱으로 설치하기</p>
          <p className="text-xs text-muted-foreground leading-tight truncate">
            홈 화면에 추가하면 더 빠르게 접속할 수 있어요
          </p>
        </div>
        <button
          onClick={onInstall}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground active:opacity-80"
        >
          <Download className="w-3.5 h-3.5" />
          설치
        </button>
        <button
          onClick={onDismiss}
          aria-label="닫기"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {showIosGuide && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:hidden"
          onClick={() => setShowIosGuide(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-background p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold mb-3">iPhone에 설치하는 방법</h3>
            <ol className="space-y-2 text-sm text-foreground">
              <li className="flex gap-2">
                <span className="font-semibold text-primary">1.</span>
                <span>Safari 하단의 <Share className="inline w-4 h-4 mx-1" /> <b>공유</b> 버튼을 누르세요.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">2.</span>
                <span><b>"홈 화면에 추가"</b>를 선택하세요.</span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-primary">3.</span>
                <span>오른쪽 상단의 <b>"추가"</b>를 누르면 완료됩니다.</span>
              </li>
            </ol>
            <button
              onClick={() => setShowIosGuide(false)}
              className="mt-5 w-full rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </>
  );
}

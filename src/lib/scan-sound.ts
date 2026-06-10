// Simple Web Audio beeps for scan feedback.
let ctx: AudioContext | null = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq: number, duration: number, type: OscillatorType = "sine", gain = 0.15) {
  const ac = getCtx();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ac.destination);
    const start = ac.currentTime;
    osc.start(start);
    osc.stop(start + duration);
  } catch {
    /* ignore */
  }
}

export function scanSuccess() {
  beep(880, 0.08, "sine", 0.18);
  setTimeout(() => beep(1320, 0.08, "sine", 0.16), 80);
}

export function scanFail() {
  beep(220, 0.18, "square", 0.2);
  setTimeout(() => beep(180, 0.22, "square", 0.18), 180);
}

export function scanDuplicate() {
  beep(440, 0.12, "triangle", 0.18);
}

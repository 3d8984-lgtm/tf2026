// QZ Tray(윈도우용 인쇄 연결 프로그램) 경유 QR 라벨 출력.
// QZ Tray가 윈도우 프린터 드라이버를 통해 출력하므로 다이컷/갭 센서 처리는
// 드라이버가 담당하고, 앱은 정확한 mm 크기의 이미지를 넘기기만 하면 된다.
//
//   사전 준비: 각 PC에 QZ Tray 설치(https://qz.io/download) 후 실행.
//   첫 연결 시 QZ Tray 허용 창이 뜨면 "기억하기"를 체크하고 허용한다.

import qz from "qz-tray";
import {
  buildFinalDiagnosticRaster, buildFinalLabelRaster, chunkRows, labelPageSizePt,
  type AgentLabelItem, type DiagnosticMode,
} from "./agent-label-print";
import type { QrLabelTemplate } from "./qr-label-template";

let securityReady = false;

/** 인증서 없이 연결 — QZ Tray가 허용 여부를 묻는 창을 띄운다. */
function ensureSecurity() {
  if (securityReady) return;
  securityReady = true;
  qz.security.setCertificatePromise((_resolve, reject) => reject(new Error("unsigned")));
  qz.security.setSignaturePromise(() => () => Promise.resolve(undefined as unknown as string));
}

export async function connectQz(): Promise<void> {
  ensureSecurity();
  if (qz.websocket.isActive()) return;
  await qz.websocket.connect({ retries: 1, delay: 1 });
}

/** QZ Tray 실행 + 프린터 존재 여부 확인. */
export async function checkQzPrinter(printerName?: string): Promise<boolean> {
  try {
    await connectQz();
    if (!printerName) return true;
    const found = await qz.printers.find(printerName);
    return Boolean(found);
  } catch {
    return false;
  }
}

export async function listQzPrinters(): Promise<string[]> {
  await connectQz();
  return qz.printers.find();
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("base64 변환 실패"));
    reader.readAsDataURL(blob);
  });

async function printRaster(printer: string, png: Blob, widthMm: number, heightMm: number) {
  const config = qz.configs.create(printer, {
    size: { width: widthMm, height: heightMm },
    units: "mm",
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    colorType: "blackwhite",
    interpolation: "nearest-neighbor",
    scaleContent: true,
    copies: 1,
    jobName: "TWINMETA-QR-LABEL",
  } as any);
  const data = [{ type: "pixel", format: "image", flavor: "base64", data: await blobToBase64(png) } as any];
  await qz.print(config, data);
}

/**
 * 라벨들을 한 줄(열 개수)씩 나눠 QZ Tray로 순차 출력한다.
 * 최종 래스터는 에이전트 경로와 동일한 함수(buildFinalLabelRaster)를 쓰므로
 * 화면 미리보기·에이전트·QZ 출력 결과가 모두 같다.
 */
export async function printLabelsViaQz(
  t: QrLabelTemplate,
  items: AgentLabelItem[],
  onProgress?: (doneRows: number, totalRows: number) => void,
): Promise<void> {
  if (items.length === 0) throw new Error("no labels");
  await connectQz();
  const printer = (t.printer_name || "").trim();
  if (!printer) throw new Error("프린터 이름이 비어 있습니다");
  const rows = chunkRows(t, items);
  for (let r = 0; r < rows.length; r++) {
    const raster = await buildFinalLabelRaster(t, rows[r]);
    await printRaster(printer, raster.png, raster.widthMm, raster.heightMm);
    onProgress?.(r + 1, rows.length);
  }
}

/** 진단 출력 — 한 줄(5열) 래스터를 rows 번 반복 전송한다. */
export async function printDiagnosticViaQz(
  t: QrLabelTemplate,
  mode: DiagnosticMode,
  rows = 10,
): Promise<void> {
  await connectQz();
  const printer = (t.printer_name || "").trim();
  if (!printer) throw new Error("프린터 이름이 비어 있습니다");
  const raster = await buildFinalDiagnosticRaster(t, mode);
  const { wMm, hMm } = labelPageSizePt({ ...t, columns: 5 }, 5);
  for (let r = 0; r < Math.max(1, rows); r++) {
    await printRaster(printer, raster.png, wMm, hMm);
  }
}

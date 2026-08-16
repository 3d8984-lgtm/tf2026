/**
 * TWINMETA 송장 프린트 에이전트 (Windows)
 *
 * 브라우저 인쇄 경로(크롬 → 드라이버 래스터화)를 건너뛰고, 4PX가 발급한 원본 PDF를
 * 로컬 프린터로 그대로 보냅니다. 열전사 프린터(APT04-A 등)에서 글자 끊김/뭉개짐이
 * 사라지고 팝업 창·수동 확인도 없어집니다.
 *
 * 필요 사항
 *   - Node.js 18 이상
 *   - SumatraPDF (portable 실행파일이면 충분): https://www.sumatrapdfreader.org/
 *
 * 실행:  node server.mjs
 * 설정:  같은 폴더의 .env (AGENT_PORT / AGENT_TOKEN / SUMATRA_PATH / DEFAULT_PRINTER)
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

// ---- config ---------------------------------------------------------------
const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.AGENT_PORT ?? 17777);
const TOKEN = (process.env.AGENT_TOKEN ?? "").trim();
const DEFAULT_PRINTER = (process.env.DEFAULT_PRINTER ?? "").trim();
const SUMATRA_CANDIDATES = [
  process.env.SUMATRA_PATH,
  "C:/Program Files/SumatraPDF/SumatraPDF.exe",
  "C:/Program Files (x86)/SumatraPDF/SumatraPDF.exe",
  path.join(process.cwd(), "SumatraPDF.exe"),
].filter(Boolean);
const SUMATRA = SUMATRA_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
const TMP = path.join(os.tmpdir(), "twinmeta-labels");
fs.mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---- helpers --------------------------------------------------------------
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-agent-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}
function send(res, status, body) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
const run = (cmd, args, timeout = 60_000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") }),
    );
  });

async function listPrinters() {
  if (process.platform !== "win32") {
    const r = await run("lpstat", ["-a"]);
    return r.stdout.split(/\r?\n/).map((l) => l.split(" ")[0]).filter(Boolean);
  }
  const r = await run("powershell", [
    "-NoProfile", "-Command",
    "Get-Printer | Select-Object -ExpandProperty Name",
  ]);
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function fetchLabel(body) {
  if (body.base64) {
    const raw = String(body.base64).replace(/^data:[^,]+,/, "");
    return { buf: Buffer.from(raw, "base64"), ext: body.ext ?? "pdf" };
  }
  const url = String(body.url ?? "");
  if (!/^https?:\/\//i.test(url)) throw new Error("url or base64 is required");
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`label download failed: HTTP ${r.status}`);
  const ctype = (r.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = ctype.includes("pdf") || url.toLowerCase().includes(".pdf")
    ? "pdf"
    : ctype.includes("png") ? "png"
    : ctype.includes("jpeg") || ctype.includes("jpg") ? "jpg"
    : "pdf";
  return { buf, ext };
}

async function printFile(file, printer, copies) {
  if (!SUMATRA) throw new Error("SumatraPDF.exe를 찾을 수 없습니다. .env의 SUMATRA_PATH를 설정하세요.");
  // noscale = 100% 실제 크기(축소 금지). 프린터 용지(100x150mm)에 원본 벡터가 그대로 찍힙니다.
  const settings = [`${copies}x`, "noscale", "portrait"].join(",");
  const args = ["-print-to", printer, "-print-settings", settings, "-silent", "-exit-when-done", file];
  const r = await run(SUMATRA, args);
  if (!r.ok) throw new Error(r.stderr || "SumatraPDF print failed");
  return args;
}

// ---- server ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    const printers = await listPrinters().catch(() => []);
    return send(res, 200, {
      ok: true, agent: "twinmeta-print-agent", version: "1.0.0",
      platform: process.platform, sumatra: SUMATRA, default_printer: DEFAULT_PRINTER,
      token_required: Boolean(TOKEN), printers,
    });
  }

  if (TOKEN && req.headers["x-agent-token"] !== TOKEN) return send(res, 401, { ok: false, error: "invalid token" });

  if (url.pathname === "/printers" && req.method === "GET") {
    return send(res, 200, { ok: true, printers: await listPrinters().catch(() => []) });
  }

  if (url.pathname === "/print" && req.method === "POST") {
    const started = Date.now();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
    catch { return send(res, 400, { ok: false, error: "invalid JSON body" }); }

    const jobId = String(body.job_id ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, "");
    const printer = String(body.printer || DEFAULT_PRINTER || "").trim();
    const copies = Math.min(10, Math.max(1, Number(body.copies ?? 1)));
    if (!printer) return send(res, 400, { ok: false, error: "printer name is not configured" });

    try {
      const { buf, ext } = await fetchLabel(body);
      const file = path.join(TMP, `${jobId}.${ext}`);
      fs.writeFileSync(file, buf);
      const args = await printFile(file, printer, copies);
      log("printed", jobId, printer, `${buf.length}B`, `${Date.now() - started}ms`);
      setTimeout(() => { try { fs.unlinkSync(file); } catch { /* keep */ } }, 60_000);
      return send(res, 200, { ok: true, job_id: jobId, printer, bytes: buf.length, ms: Date.now() - started, command: args });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log("print failed", jobId, msg);
      return send(res, 500, { ok: false, job_id: jobId, error: msg });
    }
  }

  return send(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`print agent listening on http://localhost:${PORT}`);
  log(`SumatraPDF: ${SUMATRA ?? "NOT FOUND - .env의 SUMATRA_PATH를 설정하세요"}`);
  log(`default printer: ${DEFAULT_PRINTER || "(설정 안 됨)"}`);
});

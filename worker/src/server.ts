import express from "express";
import { fetch } from "undici";
import { z } from "zod";
import { processJob } from "./processJob.js";
import { wechatResend } from "./wechat.js";
import { uploadStream } from "./uploadStream.js";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET || "";
const FUNCTIONS_URL = (process.env.SUPABASE_FUNCTIONS_URL || "").replace(/\/$/, "");

const app = express();
// JSON middleware only for internal POSTs that send JSON. The upload-stream route
// reads the raw request stream, so it must NOT pass through express.json().
app.use((req, res, next) => {
  if (req.path.startsWith("/orders/") && req.path.endsWith("/upload-stream")) return next();
  return express.json({ limit: "2mb" })(req, res, next);
});

// Simple CORS so browser-based health checks work
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-worker-secret, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

function authOk(req: express.Request): boolean {
  if (!WORKER_SECRET) return false;
  const hdr = (req.headers["x-worker-secret"] as string | undefined)
    || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return hdr === WORKER_SECRET;
}

// Basic liveness
app.get("/health", (_req, res) => {
  res.json({
    worker: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Deep health: worker + edge function reachability + WeChat config
app.get("/health/full", async (_req, res) => {
  const result: Record<string, unknown> = {
    worker: "ok",
    supabase_functions: "error",
    wechat: "error",
    timestamp: new Date().toISOString(),
  };

  // Check Supabase Edge Functions reachability
  if (!FUNCTIONS_URL || !WORKER_SECRET) {
    result.supabase_functions = "error";
    result.supabase_functions_detail = "SUPABASE_FUNCTIONS_URL or WORKER_SECRET missing";
  } else {
    try {
      const r = await fetch(`${FUNCTIONS_URL}/worker-fetch-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
        body: JSON.stringify({ jobId: "00000000-0000-0000-0000-000000000000" }),
      });
      // 401 means secret mismatch; anything that responds (even 400/404 for fake job) means reachable & authorized
      if (r.status === 401) {
        result.supabase_functions = "error";
        result.supabase_functions_detail = "unauthorized — WORKER_SECRET mismatch";
      } else {
        result.supabase_functions = "ok";
        result.supabase_functions_status = r.status;
      }
      await r.text();
    } catch (e) {
      result.supabase_functions_detail = (e as Error).message;
    }
  }

  // Check WeChat channels config
  try {
    const raw = process.env.WECHAT_WEBHOOK_KEYS;
    const legacy = process.env.WECHAT_WEBHOOK_KEY;
    let channels: string[] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      channels = Object.keys(parsed).filter((k) => typeof parsed[k] === "string" && parsed[k]);
    }
    if (channels.length > 0 || legacy) {
      result.wechat = "ok";
      result.wechat_channels = channels.length > 0 ? channels : ["(legacy default)"];
    } else {
      result.wechat_detail = "no WECHAT_WEBHOOK_KEYS or WECHAT_WEBHOOK_KEY configured";
    }
  } catch (e) {
    result.wechat_detail = `WECHAT_WEBHOOK_KEYS parse error: ${(e as Error).message}`;
  }

  const allOk = result.supabase_functions === "ok" && result.wechat === "ok";
  res.status(allOk ? 200 : 503).json(result);
});

const BodySchema = z.object({ jobId: z.string().uuid() });

app.post("/internal/process", (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "jobId required" });
  res.status(202).json({ accepted: true, jobId: parsed.data.jobId });
  processJob(parsed.data.jobId).catch((e) => {
    console.error("[process] fatal", parsed.data.jobId, e);
  });
});

app.post("/internal/wechat-resend", (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "jobId required" });
  res.status(202).json({ accepted: true });
  wechatResend(parsed.data.jobId).catch((e) =>
    console.error("[wechat-resend] fatal", parsed.data.jobId, e)
  );
});

app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
});

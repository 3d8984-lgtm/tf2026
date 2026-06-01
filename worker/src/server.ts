import express from "express";
import { z } from "zod";
import { processJob } from "./processJob.js";
import { wechatResend } from "./wechat.js";

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET || "";

const app = express();
app.use(express.json({ limit: "2mb" }));

function authOk(req: express.Request): boolean {
  if (!WORKER_SECRET) return false;
  const hdr = (req.headers["x-worker-secret"] as string | undefined)
    || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return hdr === WORKER_SECRET;
}

app.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const BodySchema = z.object({ jobId: z.string().uuid() });

app.post("/internal/process", (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "jobId required" });
  res.status(202).json({ accepted: true, jobId: parsed.data.jobId });
  // Background processing — do not await
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

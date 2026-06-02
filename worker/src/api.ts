import { fetch } from "undici";
import type { ReadStream } from "node:fs";

const FUNCTIONS_URL = (process.env.SUPABASE_FUNCTIONS_URL || "").replace(/\/$/, "");
const SECRET = process.env.WORKER_SECRET || "";

if (!FUNCTIONS_URL) console.warn("[api] SUPABASE_FUNCTIONS_URL missing");
if (!SECRET) console.warn("[api] WORKER_SECRET missing");

async function call(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${FUNCTIONS_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": SECRET,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${txt.slice(0, 300)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

export interface JobItem {
  id: string;
  idx: number;
  source_url: string;
  filename: string;
  meta: Record<string, unknown>;
  status: string;
  attempts: number;
}

export interface JobInfo {
  job: {
    id: string;
    order_no: string;
    factory: string;
    webhook_url: string;
    callback_url: string | null;
    payload: Record<string, unknown> | null;
    status: string;
    progress_total: number | null;
  };
  items: JobItem[];
  bundle: { path: string; upload_url: string; upload_token: string };
  work_order_pdf_url: string | null;
}

export async function fetchJob(jobId: string): Promise<JobInfo> {
  return call("worker-fetch-job", { jobId });
}

export interface BundleInfo {
  job: {
    id: string;
    order_no: string;
    webhook_url: string;
    bundle_zip_path: string;
    progress_total: number | null;
  };
  bundle_zip_view_url: string | null;
  bundle_zip_download_url: string | null;
}

export async function fetchBundleInfo(jobId: string): Promise<BundleInfo> {
  return call("worker-bundle-info", { jobId });
}

/** Upload buffer to Storage using a pre-signed upload URL (no service key). */
export async function uploadToSignedUrl(uploadUrl: string, body: Buffer | ReadStream, contentType = "application/zip"): Promise<void> {
  const r = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, "x-upsert": "true" },
    body: body as any,
    duplex: "half" as any,
  } as any);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`upload ${r.status}: ${t.slice(0, 300)}`);
  }
}

export async function downloadUrl(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

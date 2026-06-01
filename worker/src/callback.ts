import { fetch } from "undici";

const CALLBACK_URL = process.env.WORKER_CALLBACK_URL || "";
const SECRET = process.env.WORKER_SECRET || "";

export interface ItemUpdate {
  id?: string;
  idx?: number;
  status?: "pending" | "processing" | "uploaded" | "failed" | "skipped";
  attempts?: number;
  error_message?: string | null;
  output_path?: string | null;
}

export interface CallbackPatch {
  jobId: string;
  status?: "queued" | "processing" | "uploading" | "wechat" | "done" | "failed";
  stage?: string;
  progress_current?: number;
  progress_total?: number;
  bundle_zip_path?: string | null;
  bundle_zip_url?: string | null;
  bundle_size?: number | null;
  error_message?: string | null;
  item_updates?: ItemUpdate[];
}

export async function callback(patch: CallbackPatch): Promise<void> {
  if (!CALLBACK_URL || !SECRET) {
    console.warn("[callback] missing url/secret, skip");
    return;
  }
  try {
    const r = await fetch(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": SECRET,
      },
      body: JSON.stringify(patch),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.warn("[callback] non-2xx", r.status, txt.slice(0, 200));
    }
  } catch (e) {
    console.warn("[callback] failed", (e as Error).message);
  }
}

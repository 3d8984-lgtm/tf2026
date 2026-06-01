import { supa, STORAGE_BUCKET } from "./supabase.js";

export async function uploadBundle(path: string, body: Buffer): Promise<void> {
  const { error } = await supa.storage.from(STORAGE_BUCKET).upload(path, body, {
    contentType: "application/zip",
    upsert: true,
  });
  if (error) throw new Error(`storage upload: ${error.message}`);
}

export async function signedUrl(path: string, expiresSec = 60 * 60 * 24 * 7): Promise<string> {
  const { data, error } = await supa.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresSec);
  if (error || !data) {
    const { data: pub } = supa.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  }
  return data.signedUrl;
}

export async function downloadObject(path: string): Promise<Buffer | null> {
  const { data, error } = await supa.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

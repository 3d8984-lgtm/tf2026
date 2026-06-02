import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";

export interface ZipEntry {
  name: string;
  data?: Buffer;
  path?: string;
}

/** Build a ZIP from in-memory entries. Returns the full Buffer. */
export function buildZipBuffer(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { store: true });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);
    archive.pipe(stream);
    for (const e of entries) {
      if (e.path) archive.file(e.path, { name: e.name });
      else if (e.data) archive.append(e.data, { name: e.name });
    }
    archive.finalize();
  });
}

/** Build a ZIP on disk so large heat-transfer orders don't exhaust Render memory. */
export function buildZipFile(entries: ZipEntry[], targetPath: string): Promise<{ size: number }> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { store: true });
    const output = createWriteStream(targetPath);
    output.on("close", async () => {
      try {
        const s = await stat(targetPath);
        resolve({ size: s.size });
      } catch (e) {
        reject(e);
      }
    });
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const e of entries) {
      if (e.path) archive.file(e.path, { name: e.name });
      else if (e.data) archive.append(e.data, { name: e.name });
    }
    archive.finalize();
  });
}

import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";

export interface ZipEntry {
  name: string;
  data: Buffer;
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
    for (const e of entries) archive.append(e.data, { name: e.name });
    archive.finalize();
  });
}

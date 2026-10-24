/**
 * Media store (brief §10): bytes live OUTSIDE the web root in ./.media
 * (env-overridable), never as bytea rows, and are served — later, with
 * evidence views in M3 — through a checked route, not a static folder.
 * Simulator media ids are just these file ids; the WhatsApp provider will
 * translate graph media ids through the same interface (getMedia).
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaPayload } from "./types";

const MAX_BYTES = 10 * 1024 * 1024; // WhatsApp photo scale, honest 10 MB cap

const EXT_FOR: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};
const MIME_FOR: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_FOR).map(([mime, ext]) => [ext, mime]),
);

export function mediaRoot(): string {
  return process.env.CUSTOS_MEDIA_DIR ?? path.join(process.cwd(), ".media");
}

export async function saveMedia(
  _folder: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ id: string; mimeType: string; size: number }> {
  // Flat layout: uuid names are unique enough; readMedia probes the root.
  if (bytes.byteLength > MAX_BYTES) throw new Error("file_too_large:media_10MB");
  const ext = EXT_FOR[mimeType] ?? "bin";
  const id = randomUUID();
  await mkdir(mediaRoot(), { recursive: true });
  await writeFile(path.join(mediaRoot(), `${id}.${ext}`), bytes);
  return { id, mimeType, size: bytes.byteLength };
}

export async function readMedia(id: string): Promise<MediaPayload | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  for (const ext of Object.keys(MIME_FOR).concat("bin")) {
    try {
      const bytes = await readFile(path.join(mediaRoot(), `${id}.${ext}`));
      return { bytes: new Uint8Array(bytes), mimeType: MIME_FOR[ext] ?? "application/octet-stream" };
    } catch {
      // try the next extension
    }
  }
  return null;
}

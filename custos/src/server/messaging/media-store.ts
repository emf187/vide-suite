/**
 * Media store (brief §10): bytes live OUTSIDE the web root — env-overridable,
 * defaulting to the OS temp dir so read-only Vercel filesystems keep working
 * (set CUSTOS_MEDIA_DIR for a persistent volume). Never stored as bytea rows.
 * Simulator media ids are these file ids; the WhatsApp provider translates
 * graph media ids through the same interface (getMedia) after downloading the
 * bytes — Meta's ids expire, our storage keys do not.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { kindForMime } from "@/lib/industries";
import type { MediaPayload } from "./types";

/** WhatsApp media ceiling — one honest cap across every kind. */
const MAX_BYTES = 16 * 1024 * 1024;

const EXT_FOR: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "application/pdf": "pdf",
};
const MIME_FOR: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_FOR).map(([mimeType, ext]) => [ext, mimeType]),
);
const ALL_EXTS: string[] = [...new Set([...Object.keys(MIME_FOR), "bin"])];

export function mediaRoot(): string {
  return process.env.CUSTOS_MEDIA_DIR ?? path.join(tmpdir(), "custos-media");
}

export async function saveMedia(
  _folder: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ id: string; mimeType: string; size: number }> {
  // Flat layout: uuid names are unique enough; readMedia probes the root.
  if (bytes.byteLength > MAX_BYTES) throw new Error("file_too_large:media_16MB");
  const ext = EXT_FOR[mimeType] ?? "bin";
  const id = randomUUID();
  await mkdir(mediaRoot(), { recursive: true });
  await writeFile(path.join(mediaRoot(), `${id}.${ext}`), bytes);
  return { id, mimeType, size: bytes.byteLength };
}

export async function readMedia(id: string): Promise<MediaPayload | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  for (const ext of ALL_EXTS) {
    try {
      const bytes = await readFile(path.join(mediaRoot(), `${id}.${ext}`));
      return { bytes: new Uint8Array(bytes), mimeType: MIME_FOR[ext] ?? "application/octet-stream" };
    } catch {
      // try the next extension
    }
  }
  return null;
}

/** Evidence kind for a stored media id (photo | video | audio | document). */
export async function kindForMediaId(id: string): Promise<"photo" | "video" | "audio" | "document" | null> {
  const media = await readMedia(id);
  return media ? kindForMime(media.mimeType) : null;
}

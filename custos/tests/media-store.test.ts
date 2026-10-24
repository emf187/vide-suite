import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readMedia, saveMedia } from "@/server/messaging/media-store";

let oldDir: string | undefined;

beforeEach(async () => {
  oldDir = process.env.CUSTOS_MEDIA_DIR;
  // Tests write to a throwaway dir — the repo's real .media stays untouched.
  process.env.CUSTOS_MEDIA_DIR = await mkdtemp(path.join(tmpdir(), "custos-media-"));
});

afterEach(() => {
  if (oldDir === undefined) delete process.env.CUSTOS_MEDIA_DIR;
  else process.env.CUSTOS_MEDIA_DIR = oldDir;
});

describe("M1 media store: bytes outside the web root, honest caps", () => {
  it("saves and reads back with the original mime", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const saved = await saveMedia("test-org", bytes, "image/png");
    const back = await readMedia(saved.id);
    expect(back).not.toBeNull();
    expect(back?.mimeType).toBe("image/png");
    expect(Array.from(back?.bytes ?? [])).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses an oversized photo with the honest error string", async () => {
    const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(saveMedia("test-org", tooBig, "image/jpeg")).rejects.toThrow("file_too_large:media_10MB");
  });

  it("unknown or malformed ids read as null (no directory probing)", async () => {
    expect(await readMedia(randomUUID())).toBeNull();
    expect(await readMedia("../escape-attempt")).toBeNull();
  });
});

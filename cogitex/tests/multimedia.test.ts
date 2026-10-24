import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { membershipsRepo } from "@/server/repos/memberships";
import { machinesWriteService } from "@/server/services/machines";
import { documentsService } from "@/server/services/documents";

let db: AppDb;
let ctx: Ctx;

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);
  const org = await orgsRepo.create(db, { name: "Media Plant", slug: `media-${testId()}` });
  const user = await usersRepo.create(db, { name: "Media Owner", email: `md-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: user.id, role: "owner" });
  ctx = { userId: user.id, email: user.email, name: user.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, currency: "NGN", timezone: "Africa/Lagos", roles: ["owner"] };
});

afterEach(() => {
  __resetDbForTests();
});

describe("multimedia file-store (docs & multimedia sprint)", () => {
  it("accepts video, audio and gif within the media cap and preserves the mime type", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Media pump", tag: `MD-${testId()}`, category: "pump" });
    const clip = await documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "pump-rattle.mp4", mimeType: "video/mp4", bytes: Buffer.alloc(1024 * 1024) });
    expect(clip.mimeType).toBe("video/mp4");
    const memo = await documentsService.upload(ctx, { machineId: machine.id, kind: "other", name: "voice-memo.webm", mimeType: "audio/webm", bytes: Buffer.alloc(2048) });
    expect(memo.mimeType).toBe("audio/webm");
    const gif = await documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "panel.gif", mimeType: "image/gif", bytes: Buffer.alloc(128) });
    expect(gif.mimeType).toBe("image/gif");
  });

  it("caps media at 10 MB and ordinary documents at 5 MB — a big PDF keeps the small cap", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "Cap pump", tag: `CB-${testId()}`, category: "pump" });
    // refusals happen before anything touches the DB (buffers stay in JS memory)
    await expect(
      documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "big.mp4", mimeType: "video/mp4", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("file_too_large:media_10MB");
    await expect(
      documentsService.upload(ctx, { machineId: machine.id, kind: "report", name: "big.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }),
    ).rejects.toThrow("file_too_large:5MB");
    // a 9 MB document is still refused even though a 9 MB clip would pass
    await expect(
      documentsService.upload(ctx, { machineId: machine.id, kind: "report", name: "huge-manual.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(9 * 1024 * 1024) }),
    ).rejects.toThrow("file_too_large:5MB");
    // successful writes stay modest — PGlite fixtures cannot hold multi-MB bytea rows
    const clip = await documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "short-clip.mp4", mimeType: "video/mp4", bytes: Buffer.alloc(512 * 1024) });
    expect(clip.sizeBytes).toBe(512 * 1024);
  });

  it("work-order attachments land with workOrderId set (comment-thread evidence)", async () => {
    const machine = await machinesWriteService.create(ctx, { name: "WO pump", tag: `WO-${testId()}`, category: "pump" });
    const shot = await documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "seal-shot.jpg", mimeType: "image/jpeg", bytes: Buffer.alloc(512) });
    const woDoc = await documentsService.upload(ctx, { machineId: machine.id, kind: "photo", name: "thread-photo.jpg", mimeType: "image/jpeg", bytes: Buffer.alloc(512) });
    void shot;
    // upload signature writes workOrderId when provided — the WO comment path uses it
    const withWo = await documentsService.upload(ctx, { machineId: machine.id, workOrderId: "11111111-1111-1111-1111-111111111111", kind: "photo", name: "card-photo.jpg", mimeType: "image/jpeg", bytes: Buffer.alloc(512) });
    expect(woDoc).toBeTruthy();
    expect(withWo.workOrderId).toBe("11111111-1111-1111-1111-111111111111");
  });
});

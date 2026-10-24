import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { membershipsRepo, orgsRepo, usersRepo } from "@/server/repos/base";
import { messageLog } from "@/server/db/schema";
import type { Person } from "@/server/db/schema";
import { personsService } from "@/server/services/persons";
import { conversationStateService } from "@/server/bot/state";
import { processInbound } from "@/server/bot/pipeline";
import { simulatorProvider } from "@/server/messaging/simulator";
import { BOT_MESSAGES } from "@/lib/bot/messages";
import type { InboundEvent, MediaPayload, MessagingProvider, WaButton, WaSection } from "@/server/messaging/types";

let db: AppDb;
let ctx: Ctx;

/**
 * Provider dispatch fake: records sends WITHOUT touching the DB. Used to
 * prove the pipeline dispatches through the adapter (and that a duplicate
 * webhook replay dispatches nothing). DB-truth tests use the real simulator
 * provider, whose logOut IS the message_log.
 */
class FakeProvider implements MessagingProvider {
  mode = "simulator" as const;
  texts: { to: string; text: string }[] = [];
  buttonCalls: { to: string; text: string; buttons: WaButton[] }[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.texts.push({ to, text });
  }
  async sendButtons(to: string, text: string, buttons: WaButton[]): Promise<void> {
    this.buttonCalls.push({ to, text, buttons });
  }
  async sendList(_to: string, _text: string, _sections: WaSection[]): Promise<void> {}
  async sendTemplate(_to: string, _name: string, _variables: Record<string, string>, _buttons?: WaButton[]): Promise<void> {}
  async sendDocument(_to: string, _url: string, _caption: string): Promise<void> {}
  async getMedia(_mediaId: string): Promise<MediaPayload | null> {
    return null;
  }
}

function randPhone(): string {
  return `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

function textEvent(from: string, body: string): InboundEvent {
  return { waMessageId: `sim-${randomUUID()}`, fromPhone: from, type: "text", body };
}

async function optedInPerson(name: string): Promise<Person> {
  const phone = randPhone();
  const person = await personsService.register(ctx, { name, role: "staff", phone });
  await personsService.setConsent(ctx, phone, "opted_in");
  return person;
}

beforeEach(async () => {
  db = await createTestDb();
  __setDbForTests(db);

  const org = await orgsRepo.create(db, { name: "Demo Kitchen", slug: `demo-kitchen-${testId()}` });
  const owner = await usersRepo.create(db, { name: "Ada Owner", email: `o-${testId()}@x.io`, passwordHash: "x" });
  await membershipsRepo.create(db, { organizationId: org.id, userId: owner.id, role: "owner" });
  ctx = { userId: owner.id, email: owner.email, name: owner.name, orgId: org.id, orgSlug: org.slug, orgName: org.name, role: "owner", roles: ["owner"], timezone: "Africa/Lagos" };
});

afterEach(() => {
  __resetDbForTests();
});

describe("M1 pipeline: the one path both messaging modes go through", () => {
  it("a registered, opted-in person gets the menu — and every line lands in message_log", async () => {
    const person = await optedInPerson("Ada Cook");

    const result = await processInbound(textEvent(person.phoneE164, "hi"), simulatorProvider);
    expect(result).toMatchObject({ ok: true, mode: "registered" });
    if (result.ok && result.mode === "registered") expect(result.replies).toBeGreaterThanOrEqual(1);

    const rows = await db.select().from(messageLog).where(eq(messageLog.toPhone, person.phoneE164));
    expect(rows.some((r) => r.direction === "in" && r.body === "hi")).toBe(true);
    const menu = rows.find((r) => r.direction === "out" && r.type === "interactive");
    expect(menu).toBeTruthy();
    const payload = menu?.buttonsPayload as { buttons?: { id: string; label: string }[] } | null;
    expect(payload?.buttons?.map((b) => b.label)).toContain("Show my tasks");
  });

  it("a webhook replay (same wa_message_id) logs once and dispatches zero — idempotency by unique insert", async () => {
    const person = await optedInPerson("Ada Cook");
    const ev = textEvent(person.phoneE164, "hello");

    const firstFake = new FakeProvider();
    expect(await processInbound(ev, firstFake)).toMatchObject({ ok: true });
    expect(firstFake.buttonCalls).toHaveLength(1);

    const replayFake = new FakeProvider();
    const replay = await processInbound(ev, replayFake);
    expect(replay).toMatchObject({ ok: false, error: "duplicate" });
    expect(replayFake.texts).toHaveLength(0);
    expect(replayFake.buttonCalls).toHaveLength(0);

    const ins = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.personId, person.id), eq(messageLog.direction, "in")));
    expect(ins).toHaveLength(1); // one inbound row, not two
  });

  it("unregistered numbers get ONE polite reply, logged against no org and no person", async () => {
    const stranger = randPhone();

    const result = await processInbound(textEvent(stranger, "wetin I get today"), simulatorProvider);
    expect(result).toMatchObject({ ok: true, mode: "unregistered" });

    const rows = await db.select().from(messageLog).where(eq(messageLog.toPhone, stranger));
    expect(rows).toHaveLength(2); // inbound + the single outbound
    expect(rows.every((r) => r.organizationId === null && r.personId === null)).toBe(true);
    expect(rows.some((r) => r.direction === "out" && r.body === BOT_MESSAGES.unregistered)).toBe(true);
  });

  it("STOP means silence: a stopped person's inbound is logged, answered never", async () => {
    const person = await optedInPerson("Bimbo Staff");
    await personsService.setConsent(ctx, person.phoneE164, "stopped"); // the STOP keyword flip (M2 tests the real inbound path)

    const fake = new FakeProvider();
    const result = await processInbound(textEvent(person.phoneE164, "tasks"), fake);

    expect(result).toMatchObject({ ok: true, mode: "silent" });
    expect(fake.texts).toHaveLength(0);
    expect(fake.buttonCalls).toHaveLength(0);
    const ins = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.toPhone, person.phoneE164), eq(messageLog.direction, "in")));
    expect(ins).toHaveLength(1); // logged, not answered
  });

  it("a button tap reaches the same keyword map as text", async () => {
    const person = await optedInPerson("Ada Cook");

    const fake = new FakeProvider();
    await processInbound(
      { waMessageId: `sim-${randomUUID()}`, fromPhone: person.phoneE164, type: "button", buttonId: "show_tasks", body: "Show my tasks" },
      fake,
    );
    expect(fake.texts[0]?.text).toBe(BOT_MESSAGES.tasksEmpty);
  });
});

describe("M1 conversation state: DB-backed, TTL'd, audited (§5)", () => {
  it("round-trips a live state and marks a spent TTL as expired-idle", async () => {
    const person = await optedInPerson("Ada Cook");

    await conversationStateService.set(person.id, ctx.orgId, "awaiting_task_choice", { task: "t-1" });
    const live = await conversationStateService.get(person.id);
    expect(live.state).toBe("awaiting_task_choice");
    expect(live.context).toMatchObject({ task: "t-1" });
    expect(live.expired).toBe(false);

    await conversationStateService.set(person.id, ctx.orgId, "awaiting_reading", { task: "t-1" }, -1); // spent TTL
    const spent = await conversationStateService.get(person.id);
    expect(spent).toMatchObject({ state: "idle", expired: true });
  });
});

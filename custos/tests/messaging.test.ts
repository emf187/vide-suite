import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testId } from "./helpers/db";
import { __resetDbForTests, __setDbForTests, type AppDb } from "@/server/db/client";
import type { Ctx } from "@/server/ctx";
import { membershipsRepo, orgsRepo, usersRepo } from "@/server/repos/base";
import { messageLog } from "@/server/db/schema";
import { auditEvents, evidence, tasks, type Person } from "@/server/db/schema";
import { personsService } from "@/server/services/persons";
import { tasksService } from "@/server/services/tasks";
import { runAgentCycle } from "@/server/services/agent";
import { saveMedia } from "@/server/messaging/media-store";
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

describe("M3 loop: one number's work, from push to proof", () => {
  it("runs the full media+signature loop with agent push, evidence rows and audits", async () => {
    const person = await optedInPerson("Ada Cook");

    const task = await tasksService.create(ctx, {
      personId: person.id,
      title: "Close the freezer",
      instructions: "Below -18 C, then shut the door",
      withMedia: true,
      withSignature: true,
    });

    // the agent pushed the task card instantly (the person is opted in)
    const push = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.personId, person.id), eq(messageLog.direction, "out")));
    const pushRow = push.find((r) => r.type === "interactive");
    expect(pushRow?.body).toContain("New task: Close the freezer");
    const payload = pushRow?.buttonsPayload as { buttons?: { id: string; label: string }[] } | null;
    expect(payload?.buttons?.[0]?.id).toBe(`task:${task.id}`);

    // "tasks" with exactly one open task walks straight into the proof flow
    await processInbound(textEvent(person.phoneE164, "tasks"), simulatorProvider);
    expect((await conversationStateService.get(person.id)).state).toBe("awaiting_media");

    // a photo arrives (real bytes through the store) → a signature is demanded
    const photo = await saveMedia("flow", new Uint8Array([9, 9, 9]), "image/png");
    await processInbound(
      { waMessageId: `sim-${randomUUID()}`, fromPhone: person.phoneE164, type: "media", mediaId: photo.id },
      simulatorProvider,
    );
    expect((await conversationStateService.get(person.id)).state).toBe("awaiting_signature");
    const afterPhoto = await db.select().from(evidence).where(eq(evidence.taskId, task.id));
    expect(afterPhoto).toHaveLength(1);
    expect(afterPhoto[0]?.kind).toBe("photo");
    expect(afterPhoto[0]?.mediaUrl).toBe(photo.id);

    // the typed full name signs it off → done, proof complete
    await processInbound(textEvent(person.phoneE164, "Ada Fulani Cook"), simulatorProvider);
    const doneTask = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0];
    expect(doneTask?.status).toBe("done");
    expect(doneTask?.completedAt).toBeTruthy();
    const all = await db.select().from(evidence).where(eq(evidence.taskId, task.id));
    expect(all).toHaveLength(2);
    expect(all.find((e) => e.kind === "signature")?.value).toBe("Ada Fulani Cook");

    // the whole loop is on the audit trail
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, ctx.orgId));
    const actions = audits.map((a) => a.action);
    for (const expected of ["task.created", "agent.task_dispatch", "conversation.state", "evidence.recorded", "evidence.signed", "task.completed"]) {
      expect(actions).toContain(expected);
    }
  });

  it("media-only tasks close right at the media (the mime decides the evidence kind)", async () => {
    const person = await optedInPerson("Bimbo Staff");
    const task = await tasksService.create(ctx, {
      personId: person.id,
      title: "Send a shelf clip",
      withMedia: true,
      withSignature: false,
    });

    await processInbound(textEvent(person.phoneE164, "tasks"), simulatorProvider);
    const clip = await saveMedia("flow", new Uint8Array([1, 2]), "video/mp4");
    await processInbound(
      { waMessageId: `sim-${randomUUID()}`, fromPhone: person.phoneE164, type: "media", mediaId: clip.id },
      simulatorProvider,
    );

    const doneTask = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0];
    expect(doneTask?.status).toBe("done");
    const rows = await db.select().from(evidence).where(eq(evidence.taskId, task.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("video"); // mime-mapped, never assumed photo
    expect((await conversationStateService.get(person.id)).state).toBe("idle"); // the flow reset itself
  });

  it("multiple open tasks come back as a tappable list, and a tap starts THAT task", async () => {
    const person = await optedInPerson("Ada Cook");
    await tasksService.create(ctx, { personId: person.id, title: "Task one", withMedia: false, withSignature: true });
    await tasksService.create(ctx, { personId: person.id, title: "Task two", withMedia: true, withSignature: false });

    await processInbound(textEvent(person.phoneE164, "tasks"), simulatorProvider);
    expect((await conversationStateService.get(person.id)).state).toBe("awaiting_task_choice");

    const rows = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.personId, person.id), eq(messageLog.direction, "out")));
    const listRow = [...rows].reverse().find((r) => r.type === "interactive");
    const listPayload = listRow?.buttonsPayload as { sections?: { rows?: { id: string; title: string }[] }[] } | null;
    const rowIds = listPayload?.sections?.[0]?.rows?.map((r) => r.id) ?? [];
    expect(rowIds.filter((id) => id.startsWith("task:"))).toHaveLength(2);

    const firstRow = rowIds[0];
    if (!firstRow) throw new Error("the list returned no rows");
    await processInbound(
      { waMessageId: `sim-${randomUUID()}`, fromPhone: person.phoneE164, type: "button", buttonId: firstRow },
      simulatorProvider,
    );
    expect((await conversationStateService.get(person.id)).state).toBe("awaiting_signature"); // task one is signature-only
  });

  it("a supervisor hears the team pulse on 'proof', counted from real rows", async () => {
    const staff = await optedInPerson("Ada Cook");
    const supervisor = await personsService.register(ctx, { name: "Seyi Supervisor", role: "supervisor", phone: randPhone() });
    await personsService.setConsent(ctx, supervisor.phoneE164, "opted_in");

    const task = await tasksService.create(ctx, { personId: staff.id, title: "Turn the gas off", withMedia: false, withSignature: true });
    await processInbound(textEvent(staff.phoneE164, "tasks"), simulatorProvider); // one open → signature ask
    await processInbound(textEvent(staff.phoneE164, "Ada Fulani Cook"), simulatorProvider); // signed off

    const fake = new FakeProvider();
    await processInbound(textEvent(supervisor.phoneE164, "proof"), fake);
    expect(fake.texts[0]?.text).toContain("Team status");
    expect(fake.texts[0]?.text).toContain("1 task"); // one done in the last 24 h
    expect((await tasksService.byId(task.id))?.status).toBe("done");
  });
});

describe("M2 consent on the real inbound path", () => {
  it("a pending person gets askStart until they send START — then the menu", async () => {
    const phone = randPhone();
    const person = await personsService.register(ctx, { name: "Ngozi Staff", role: "staff", phone });

    const first = new FakeProvider();
    await processInbound(textEvent(phone, "hi"), first);
    expect(first.texts[0]?.text).toBe(BOT_MESSAGES.askStart);

    const second = new FakeProvider();
    await processInbound(textEvent(phone, "START"), second);
    expect(second.texts[0]?.text).toContain("Hello Ngozi Staff!");
    expect(second.buttonCalls).toHaveLength(1); // the menu follows the welcome

    const fresh = await personsService.byId(person.id);
    expect(fresh?.consentStatus).toBe("opted_in");
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, ctx.orgId));
    expect(audits.map((a) => a.action)).toContain("consent.started");
  });

  it("STOP via inbound confirms once, flips consent, then true silence", async () => {
    const person = await optedInPerson("Chidi Staff");

    const fake = new FakeProvider();
    const result = await processInbound(textEvent(person.phoneE164, "stop"), fake);
    expect(result).toMatchObject({ ok: true, mode: "registered" });
    expect(fake.texts[0]?.text).toBe(BOT_MESSAGES.stoppedConfirm);

    const fresh = await personsService.byId(person.id);
    expect(fresh?.consentStatus).toBe("stopped");

    const after = new FakeProvider();
    await processInbound(textEvent(person.phoneE164, "hi"), after);
    expect(after.texts).toHaveLength(0);
    expect(after.buttonCalls).toHaveLength(0);
  });

  it("menus are role-aware: heads get Team status, staff get Report a problem", async () => {
    const supervisor = await personsService.register(ctx, { name: "The Head", role: "supervisor", phone: randPhone() });
    await personsService.setConsent(ctx, supervisor.phoneE164, "opted_in");

    const headFake = new FakeProvider();
    await processInbound(textEvent(supervisor.phoneE164, "hi"), headFake);
    expect(headFake.buttonCalls[0]?.buttons.map((b) => b.label)).toContain("Team status");

    const staffFake = new FakeProvider();
    const staff = await optedInPerson("Bimbo Staff");
    await processInbound(textEvent(staff.phoneE164, "hi"), staffFake);
    expect(staffFake.buttonCalls[0]?.buttons.map((b) => b.label)).toContain("Report a problem");
    expect(staffFake.buttonCalls[0]?.buttons.map((b) => b.label)).not.toContain("Team status");
  });
});

describe("M4 agent heartbeat (demo-speed)", () => {
  it("flips overdue, reminds on a ≥12 h gap, digests once per ~24 h — gated on rows, never memory", async () => {
    const person = await optedInPerson("Ada Cook");
    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: ctx.orgId,
        assigneeId: person.id,
        title: "Late freezer log",
        taskType: "simple_done",
        evidenceSpec: [],
        dueAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      })
      .returning();
    if (!task) throw new Error("task insert returned no rows");

    const first = await runAgentCycle();
    expect(first.overdue).toBe(1);
    expect(first.reminders).toBe(1);
    expect(first.digests).toBe(1);

    const row = (await db.select().from(tasks).where(eq(tasks.id, task.id)))[0];
    expect(row?.status).toBe("overdue");
    expect(row?.lastNotifiedAt).toBeTruthy();
    expect(row?.escalationLevel).toBe(1);

    const outs = await db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.personId, person.id), eq(messageLog.direction, "out")));
    expect(outs.some((r) => r.templateName === "task_reminder")).toBe(true);
    expect(outs.some((r) => r.templateName === "daily_task_summary")).toBe(true);

    // the second cycle stays quiet — reminder gap + audit-gated digest
    const second = await runAgentCycle();
    expect(second.overdue).toBe(0);
    expect(second.reminders).toBe(0);
    expect(second.digests).toBe(0);
  });
});

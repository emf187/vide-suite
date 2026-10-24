/**
 * The inbound pipeline (brief §9) — identical for both messaging modes:
 * normalize (upstream) → dedupe by wa_message_id → resolve the person →
 * CONSENT (§4.1: pending waits for START; STOP silences after one confirm) →
 * handler → send replies through the provider → everything logged. Meta may
 * deliver the same webhook more than once; the unique wa_message_id insert
 * makes a replay a no-op (idempotency is a test).
 */
import { eq } from "drizzle-orm";
import { getDb, type AppDb } from "@/server/db/client";
import { auditRepo } from "@/server/repos/audit";
import { messageLog, persons } from "@/server/db/schema";
import { BOT_MESSAGES } from "@/lib/bot/messages";
import { personsService } from "@/server/services/persons";
import { respondTo, menuFor } from "./handler";
import { dispatchReply } from "@/server/messaging/dispatch";
import { getProvider } from "@/server/messaging/provider";
import type { InboundEvent, MessagingProvider } from "@/server/messaging/types";

export type ProcessResult =
  | { ok: true; mode: "registered"; replies: number }
  | { ok: true; mode: "unregistered" }
  | { ok: true; mode: "silent" } // STOPped or deactivated: logged, answered never (§4.1)
  | { ok: false; error: "duplicate" };

export async function processInbound(
  ev: InboundEvent,
  provider: MessagingProvider = getProvider(),
): Promise<ProcessResult> {
  const db = (await getDb()) as AppDb;
  const person = await personsService.findByPhone(ev.fromPhone);

  // Dedupe + inbound log in ONE unique insert — a replay dies here quietly.
  try {
    await db.insert(messageLog).values({
      waMessageId: ev.waMessageId,
      direction: "in",
      personId: person?.id ?? null,
      organizationId: person?.organizationId ?? null,
      toPhone: ev.fromPhone, // outbound rows carry the target; inbound rows carry the sender
      type: ev.type,
      body: ev.body ?? null,
      mediaId: ev.mediaId ?? null,
      status: "received",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("message_log_wa_id_key")) return { ok: false, error: "duplicate" };
    throw err;
  }

  if (!person) {
    // One polite reply per unregistered message; nothing more, and it's logged.
    await dispatchReply(provider, ev.fromPhone, [{ kind: "text", text: BOT_MESSAGES.unregistered }]);
    return { ok: true, mode: "unregistered" };
  }

  if (person.deactivatedAt || person.consentStatus === "stopped") {
    return { ok: true, mode: "silent" };
  }

  if (person.consentStatus === "pending") {
    // The PERSON owns consent: only an explicit START opts them in.
    if ((ev.body ?? "").trim().toLowerCase() === "start") {
      await flipConsent(db, person, "opted_in");
      const orgName = await orgNameFor(db, person.organizationId);
      const sent = await dispatchReply(provider, person.phoneE164, [
        { kind: "text", text: BOT_MESSAGES.welcome(person.name, person.role, orgName ?? "your workplace") },
      ]);
      const menuSent = await dispatchReply(provider, person.phoneE164, [
        { kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuFor(person) },
      ]);
      return { ok: true, mode: "registered", replies: sent + menuSent };
    }
    await dispatchReply(provider, person.phoneE164, [{ kind: "text", text: BOT_MESSAGES.askStart }]);
    return { ok: true, mode: "registered", replies: 1 };
  }

  // opted-in: STOP flips out with one last confirmation; then true silence.
  if ((ev.body ?? "").trim().toLowerCase() === "stop") {
    await flipConsent(db, person, "stopped");
    await dispatchReply(provider, person.phoneE164, [{ kind: "text", text: BOT_MESSAGES.stoppedConfirm }]);
    return { ok: true, mode: "registered", replies: 1 };
  }

  const replies = await respondTo(person, ev);
  const sent = await dispatchReply(provider, person.phoneE164, replies);
  return { ok: true, mode: "registered", replies: sent };
}

async function flipConsent(
  db: AppDb,
  person: { id: string; organizationId: string },
  status: "opted_in" | "stopped",
): Promise<void> {
  await db
    .update(persons)
    .set({ consentStatus: status, consentAt: new Date(), updatedAt: new Date() })
    .where(eq(persons.id, person.id));
  await auditRepo.log(db, {
    organizationId: person.organizationId,
    actorKind: "person",
    actorPersonId: person.id,
    action: status === "opted_in" ? "consent.started" : "consent.stopped",
    entity: "person",
    entityId: person.id,
    after: { consentStatus: status },
  });
}

async function orgNameFor(db: AppDb, orgId: string): Promise<string | null> {
  const { orgsRepo } = await import("@/server/repos/base");
  const org = await orgsRepo.byId(db, orgId);
  return org?.name ?? null;
}

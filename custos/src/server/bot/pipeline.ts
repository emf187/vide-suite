/**
 * The inbound pipeline (brief §9) — identical for both messaging modes:
 * normalize (done upstream) → dedupe by wa_message_id → resolve the person →
 * consent rules → handler → send replies through the provider → everything
 * logged. Meta may deliver the same webhook more than once; the unique
 * wa_message_id insert makes a replay a no-op (idempotency is a test, M8).
 */
import { getDb, type AppDb } from "@/server/db/client";
import { messageLog } from "@/server/db/schema";
import { BOT_MESSAGES } from "@/lib/bot/messages";
import { personsService } from "@/server/services/persons";
import { respondTo } from "./handler";
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
    await provider.sendText(ev.fromPhone, BOT_MESSAGES.unregistered);
    return { ok: true, mode: "unregistered" };
  }

  if (person.consentStatus === "stopped" || person.deactivatedAt) {
    return { ok: true, mode: "silent" };
  }

  const replies = await respondTo(person, ev);
  let sent = 0;
  for (const reply of replies) {
    switch (reply.kind) {
      case "none":
        break;
      case "text":
        await provider.sendText(person.phoneE164, reply.text);
        sent += 1;
        break;
      case "buttons":
        await provider.sendButtons(person.phoneE164, reply.text, reply.buttons);
        sent += 1;
        break;
      case "list":
        await provider.sendList(person.phoneE164, reply.text, reply.sections);
        sent += 1;
        break;
      case "template":
        await provider.sendTemplate(person.phoneE164, reply.name, reply.variables, reply.buttons);
        sent += 1;
        break;
      case "document":
        await provider.sendDocument(person.phoneE164, reply.url, reply.caption);
        sent += 1;
        break;
    }
  }
  return { ok: true, mode: "registered", replies: sent };
}

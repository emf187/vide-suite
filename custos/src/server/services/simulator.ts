/**
 * Simulator read-side (M1): the transcript IS message_log — no second copy of
 * chat history anywhere. Read paths mirror what the WhatsApp provider would
 * need, so M7 swaps the transport and leaves this untouched.
 */
import { asc, eq, or } from "drizzle-orm";
import { getDb, type AppDb } from "@/server/db/client";
import { messageLog, type MessageRow, type Person } from "@/server/db/schema";
import type { Ctx } from "@/server/ctx";

/**
 * Every line of a chat: inbound rows (personId set or bare phone for
 * unregistered senders) plus outbound rows addressed to that phone.
 */
export async function transcriptFor(person: Person | null, phone: string): Promise<MessageRow[]> {
  const db = (await getDb()) as AppDb;
  return db
    .select()
    .from(messageLog)
    .where(
      person
        ? or(eq(messageLog.personId, person.id), eq(messageLog.toPhone, phone))
        : eq(messageLog.toPhone, phone),
    )
    .orderBy(asc(messageLog.createdAt))
    .limit(200);
}

/** People for the picker chips (org-scoped, same service the dashboard uses). */
export async function peopleForPicker(ctx: Ctx): Promise<Person[]> {
  const { personsService } = await import("@/server/services/persons");
  return personsService.list(ctx);
}

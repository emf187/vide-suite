"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { processInbound } from "@/server/bot/pipeline";
import { personsService, normalizePhone } from "@/server/services/persons";
import { saveMedia } from "@/server/messaging/media-store";
import type { InboundEvent } from "@/server/messaging/types";

/**
 * One server action plays the WhatsApp-app role: a form post IS an inbound
 * message. No client JS anywhere on the simulator — server actions + GET
 * chips + submit-button taps carry the whole screen (house rule).
 */
export async function sendAsAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  // Quick-reply words ride under "quick"; taps (list rows / buttons) under "tap".
  const quick = String(formData.get("quick") ?? "").trim();
  const tap = String(formData.get("tap") ?? "").trim();
  const body = quick || String(formData.get("body") ?? "").trim();
  const file = formData.get("photo");

  // Resolve the sender: a registered person, or a bare number (unregistered mode).
  let phone: string | null = rawPhone ? normalizePhone(rawPhone) : null;
  if (personId) {
    const person = await personsService.byId(personId);
    if (person) phone = person.phoneE164;
    else redirect("/simulator?error=target");
  }
  if (!phone) redirect("/simulator?error=target");
  const backPath = `/simulator?${personId ? `p=${encodeURIComponent(personId)}` : `phone=${encodeURIComponent(phone)}`}`;

  const hasFile = file instanceof File && file.size > 0;
  let mediaId: string | undefined;
  if (hasFile) {
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    try {
      const saved = await saveMedia(personId || "unregistered", bytes, (file as File).type || "application/octet-stream");
      mediaId = saved.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("file_too_large")) redirect(`${backPath}&error=too_large`);
      throw err;
    }
  }
  if (!tap && !body && !mediaId) redirect(`${backPath}&error=empty`);

  // MESSAGING_MODE decides the provider; the pipeline is the same path real
  // webhook events take in M7 — the simulator is not a special case.
  const ev: InboundEvent = tap
    ? { waMessageId: `sim-${randomUUID()}`, fromPhone: phone, type: "button", buttonId: tap }
    : mediaId
      ? { waMessageId: `sim-${randomUUID()}`, fromPhone: phone, type: "media", body: body || undefined, mediaId }
      : { waMessageId: `sim-${randomUUID()}`, fromPhone: phone, type: "text", body };
  await processInbound(ev);

  revalidatePath("/simulator");
  redirect(backPath);
}

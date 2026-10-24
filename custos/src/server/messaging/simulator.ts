/**
 * SimulatorProvider — the safety-net mode (brief §0/§9). Outbound messages are
 * written to message_log, which IS the simulator's screen; no Meta account,
 * no external dependency. Same interface the WhatsApp provider will keep,
 * so handlers/providers stay swappable via MESSAGING_MODE.
 */
import { randomUUID } from "node:crypto";
import { getDb, type AppDb } from "@/server/db/client";
import { messageLog } from "@/server/db/schema";
import { personsService } from "@/server/services/persons";
import { TEMPLATES } from "@/lib/bot/messages";
import { readMedia } from "./media-store";
import type { MediaPayload, MessagingProvider, WaButton, WaSection } from "./types";

type OutFields = {
  body?: string;
  mediaId?: string | null;
  templateName?: string | null;
  buttonsPayload?: unknown;
};

async function logOut(to: string, type: string, fields: OutFields): Promise<void> {
  const db = (await getDb()) as AppDb;
  const person = await personsService.findByPhone(to);
  await db.insert(messageLog).values({
    organizationId: person?.organizationId ?? null,
    // Simulator mints a fresh id; the real provider uses Meta's wamid.
    waMessageId: `sim-${randomUUID()}`,
    direction: "out",
    personId: person?.id ?? null,
    toPhone: to,
    type,
    body: fields.body ?? null,
    mediaId: fields.mediaId ?? null,
    templateName: fields.templateName ?? null,
    buttonsPayload: fields.buttonsPayload ?? null,
    status: "sent",
  });
}

export const simulatorProvider: MessagingProvider = {
  mode: "simulator",

  async sendText(to, text) {
    await logOut(to, "text", { body: text });
  },

  async sendButtons(to, text, buttons: WaButton[]) {
    await logOut(to, "interactive", { body: text, buttonsPayload: { buttons } });
  },

  async sendList(to, text, sections: WaSection[]) {
    await logOut(to, "interactive", { body: text, buttonsPayload: { sections } });
  },

  async sendTemplate(to, name, variables, buttons) {
    const render = TEMPLATES[name];
    if (!render) throw new Error(`unknown_template:${name}`);
    await logOut(to, "template", {
      body: render(variables),
      templateName: name,
      buttonsPayload: buttons ? { buttons } : null,
    });
  },

  async sendDocument(to, url, caption) {
    await logOut(to, "media", { body: caption, mediaId: url });
  },

  async getMedia(mediaId): Promise<MediaPayload | null> {
    return readMedia(mediaId);
  },
};

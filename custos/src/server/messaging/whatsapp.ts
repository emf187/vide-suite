/**
 * WhatsAppCloudProvider — M7 milestone STUB, deliberately not wired: every
 * method refuses loudly until the WA_* env vars exist and the signed webhook
 * route lands. We never use unofficial WhatsApp client automation (Meta ToS,
 * number bans); this provider will call graph.facebook.com only.
 */
import type { MediaPayload, MessagingProvider, WaButton, WaSection } from "./types";

export function whatsappEnvReady(): boolean {
  return (
    Boolean(process.env.WA_BUSINESS_PHONE_NUMBER_ID) &&
    Boolean(process.env.WA_ACCESS_TOKEN) &&
    Boolean(process.env.WA_APP_SECRET) &&
    Boolean(process.env.WA_WEBHOOK_VERIFY_TOKEN)
  );
}

async function refuse(): Promise<never> {
  throw new Error(
    whatsappEnvReady()
      ? "whatsapp_mode_not_built" // M7 will implement graph calls behind this same interface
      : "whatsapp_mode_not_configured",
  );
}

export const whatsappProvider: MessagingProvider = {
  mode: "whatsapp",
  sendText: refuse,
  sendButtons: refuse as (to: string, text: string, buttons: WaButton[]) => Promise<void>,
  sendList: refuse as (to: string, text: string, sections: WaSection[]) => Promise<void>,
  sendTemplate: refuse as (
    to: string,
    name: string,
    variables: Record<string, string>,
    buttons?: WaButton[],
  ) => Promise<void>,
  sendDocument: refuse,
  getMedia: async (): Promise<MediaPayload | null> => null,
};

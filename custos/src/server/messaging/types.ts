/**
 * The messaging contract (brief §9). The bot logic must never know which mode
 * it is in — it only speaks in these types. Two implementations:
 *   - SimulatorProvider (src/server/messaging/simulator.ts): always works.
 *   - WhatsAppCloudProvider (M7): Meta's Cloud API, same interface.
 */

export type WaButton = { id: string; label: string };
export type WaSection = {
  title: string;
  rows: { id: string; title: string; description?: string }[];
};

/** The normalized shape of an inbound event — both the simulator and the real webhook (M7) funnel into this. */
export type InboundEvent = {
  waMessageId: string;
  fromPhone: string; // E.164
  type: "text" | "button" | "list_select" | "photo" | "document";
  body?: string;
  buttonId?: string;
  mediaId?: string;
  at?: Date;
};

export type MediaPayload = { bytes: Uint8Array; mimeType: string };

export interface MessagingProvider {
  readonly mode: "simulator" | "whatsapp";
  sendText(to: string, text: string): Promise<void>;
  sendButtons(to: string, text: string, buttons: WaButton[]): Promise<void>;
  sendList(to: string, text: string, sections: WaSection[]): Promise<void>;
  sendTemplate(to: string, name: string, variables: Record<string, string>, buttons?: WaButton[]): Promise<void>;
  sendDocument(to: string, url: string, caption: string): Promise<void>;
  getMedia(mediaId: string): Promise<MediaPayload | null>;
}

/** What the handler produces; the pipeline turns this into provider calls. */
export type BotReply =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "buttons"; text: string; buttons: WaButton[] }
  | { kind: "list"; text: string; sections: WaSection[] }
  | { kind: "template"; name: string; variables: Record<string, string>; buttons?: WaButton[] }
  | { kind: "document"; url: string; caption: string };

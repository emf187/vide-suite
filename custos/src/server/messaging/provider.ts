/**
 * Provider mode switch (brief §9): MESSAGING_MODE env — "simulator" (default,
 * always works) or "whatsapp" (Meta Cloud API, lands in M7). The bot logic
 * gets a provider through here and never learns which one it is.
 */
import type { MessagingProvider } from "./types";
import { simulatorProvider } from "./simulator";
import { whatsappProvider } from "./whatsapp";

export type MessagingMode = "simulator" | "whatsapp";

export function currentMode(): MessagingMode {
  const raw = (process.env.MESSAGING_MODE ?? "simulator").toLowerCase();
  return raw === "whatsapp" ? "whatsapp" : "simulator";
}

export function getProvider(): MessagingProvider {
  return currentMode() === "whatsapp" ? whatsappProvider : simulatorProvider;
}

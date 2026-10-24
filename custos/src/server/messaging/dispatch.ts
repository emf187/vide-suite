/**
 * The one dispatcher. Inbound replies (pipeline) and AGENT pushes (services)
 * send through the exact same switch — provider-agnostic by construction.
 */
import type { BotReply, MessagingProvider } from "./types";

export async function dispatchReply(
  provider: MessagingProvider,
  to: string,
  replies: BotReply[],
): Promise<number> {
  let sent = 0;
  for (const reply of replies) {
    switch (reply.kind) {
      case "none":
        break;
      case "text":
        await provider.sendText(to, reply.text);
        sent += 1;
        break;
      case "buttons":
        await provider.sendButtons(to, reply.text, reply.buttons);
        sent += 1;
        break;
      case "list":
        await provider.sendList(to, reply.text, reply.sections);
        sent += 1;
        break;
      case "template":
        await provider.sendTemplate(to, reply.name, reply.variables, reply.buttons);
        sent += 1;
        break;
      case "document":
        await provider.sendDocument(to, reply.url, reply.caption);
        sent += 1;
        break;
    }
  }
  return sent;
}

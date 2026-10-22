import type { NotificationClient, NotificationInput } from "@/lib/integrations/interfaces";

/** Mock NotificationClient — records sends; dedupes by (userId, kind, dedupeKey). */
export class MockNotificationClient implements NotificationClient {
  sent: NotificationInput[] = [];
  private seen = new Set<string>();

  async send(input: NotificationInput): Promise<"queued" | "sent" | "skipped"> {
    if (input.dedupeKey) {
      const key = `${input.userId}:${input.kind}:${input.dedupeKey}`;
      if (this.seen.has(key)) return "skipped";
      this.seen.add(key);
    }
    this.sent.push({ ...input });
    return input.channel === "in_app" ? "sent" : "queued";
  }

  async health(): Promise<{ provider: string; ok: boolean }> {
    return { provider: "mock", ok: true };
  }
}

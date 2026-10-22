import { NextResponse } from "next/server";
import { getCtx } from "@/server/ctx";
import { agentService } from "@/server/services/agent";

/**
 * Agent chat (M7). Session-gated; roles always re-derived server-side. Body:
 *   { message: "..." }        → interpreted (local matcher, or LLM for intent only)
 *   { confirm: "<logId>" }    → executes a previously proposed WRITE
 *   { discard: "<logId>" }    → drops a proposal
 */
export async function POST(req: Request): Promise<Response> {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const b = (body ?? {}) as { message?: unknown; confirm?: unknown; discard?: unknown };

  try {
    if (typeof b.confirm === "string") {
      const reply = await agentService.confirmProposal(ctx, b.confirm);
      return NextResponse.json({ ok: true, reply });
    }
    if (typeof b.discard === "string") {
      await agentService.discardProposal(ctx, b.discard);
      return NextResponse.json({ ok: true, reply: { text: "Discarded — nothing ran.", citations: [], via: "local" } });
    }
    if (typeof b.message === "string") {
      const reply = await agentService.chat(ctx, b.message);
      return NextResponse.json({ ok: true, reply });
    }
    return NextResponse.json({ error: "message_or_confirm_required" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "agent_error" }, { status: 400 });
  }
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { agentService, type AgentHistory } from "@/server/services/agent";

/**
 * The agent chat is a PLAIN server-action form (progressive enhancement): it works with
 * JS (intercepted by Next) AND without it (native form POST + redirect). The conversation
 * rides in a cookie so the session survives full navigations — no client state machine,
 * which is precisely what brittle browser profiles break.
 */

const COOKIE = "cogitex_agent_chat";
const MAX_MESSAGES = 10;

export type ChatMsg = {
  role: "user" | "agent";
  text: string;
  citations?: { kind: string; id: string; label: string }[];
  proposal?: { logId: string; tool: string };
};

async function readHistory(): Promise<ChatMsg[]> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const msgs: ChatMsg[] = [];
    for (const m of parsed) {
      if (typeof m !== "object" || m === null) continue;
      const cand = m as Record<string, unknown>;
      if (typeof cand.text !== "string" || (cand.role !== "user" && cand.role !== "agent")) continue;
      const msg: ChatMsg = { role: cand.role, text: cand.text };
      if (Array.isArray(cand.citations) && cand.citations.length > 0) {
        const cites = (cand.citations as Record<string, unknown>[])
          .filter((c) => typeof c?.id === "string" && typeof c?.kind === "string" && typeof c?.label === "string")
          .slice(0, 12)
          .map((c) => ({ kind: c.kind as string, id: c.id as string, label: c.label as string }));
        if (cites.length > 0) msg.citations = cites;
      }
      if (
        typeof (cand.proposal as { logId?: unknown } | undefined)?.logId === "string" &&
        typeof (cand.proposal as { tool?: unknown } | undefined)?.tool === "string"
      ) {
        msg.proposal = { logId: (cand.proposal as { logId: string }).logId, tool: (cand.proposal as { tool: string }).tool };
      }
      msgs.push(msg);
    }
    return msgs.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

async function writeHistory(msgs: ChatMsg[]): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(msgs.slice(-MAX_MESSAGES)), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 6 * 60 * 60,
  });
}

/** Chat history for the RSC render. */
export async function readAgentChatHistory(): Promise<ChatMsg[]> {
  return readHistory();
}

/** Composer submit: run the agent, append user+agent turns, reload the page. */
export async function agentAskAction(formData: FormData): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const message = String(formData.get("message") ?? "").trim().slice(0, 500);
  const history = await readHistory();
  if (message) {
    let agentTurn: ChatMsg;
    // Multi-turn: the recent server-held turns give the intent/phrasing LLMs follow-up context.
    const conversation: AgentHistory = history
      .filter((m) => !(m.role === "agent" && m.proposal)) // stale proposals carry no conversational value
      .map((m) => ({ role: m.role, text: m.text }));
    try {
      const reply = await agentService.chat(ctx, message, conversation.slice(-6));
      agentTurn = { role: "agent", text: reply.text };
      if (reply.citations?.length) agentTurn.citations = reply.citations.slice(0, 12);
      if (reply.proposal) agentTurn.proposal = { logId: reply.proposal.logId, tool: reply.proposal.tool };
    } catch (err) {
      agentTurn = { role: "agent", text: `Agent error — ${err instanceof Error ? err.message : "unknown failure"}. Try rephrasing.` };
    }
    await writeHistory([...history, { role: "user", text: message }, agentTurn]);
  }
  redirect("/agent");
}

/** CONFIRM on a pending proposal: execute the stored write. */
export async function agentConfirmAction(formData: FormData): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const history = await readHistory();
  const logId = String(formData.get("logId") ?? "");
  let turn: ChatMsg;
  try {
    const reply = await agentService.confirmProposal(ctx, logId);
    turn = { role: "agent", text: reply.text, citations: reply.citations?.slice(0, 12) };
  } catch (err) {
    turn = { role: "agent", text: `Could not execute — ${err instanceof Error ? err.message : "unknown failure"}.` };
  }
  await writeHistory([...history, turn]);
  redirect("/agent");
}

/** DISCARD on a pending proposal: drop it, nothing runs. */
export async function agentDiscardAction(formData: FormData): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const history = await readHistory();
  try {
    await agentService.discardProposal(ctx, String(formData.get("logId") ?? ""));
  } catch {
    // err-muted: discard is best-effort — the log simply stays pending
  }
  await writeHistory([...history, { role: "agent", text: "Discarded — nothing ran." }]);
  redirect("/agent");
}

/** Clear the window (server v stays; every write is in agent_tool_logs). */
export async function agentClearAction(): Promise<void> {
  (await cookies()).delete(COOKIE);
  redirect("/agent");
}

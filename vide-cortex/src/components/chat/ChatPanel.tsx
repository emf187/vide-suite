"use client";

import { useState } from "react";
import { Button, Check, EmptyState, Input, cx } from "@/components/ui";

interface Message {
  id: number;
  who: "user" | "llm";
  text: string;
  via?: string;
}

interface Props {
  /** Example question shown in the empty log. */
  example: string;
  placeholder: string;
  contextLabel: string;
  /** Builds the context block appended to the question (machine data, verdicts…). */
  getContext: () => string;
  onAnswer?: (text: string) => void;
}

let nextId = 1;

/**
 * LLM chat about the machine/topic in view. Sends `message + context` to POST /api/chat
 * (OpenRouter through the server). No simulated answers: on any backend failure the reply
 * states the error honestly instead of echoing made-up text.
 */
export function ChatPanel({ example, placeholder, contextLabel, getContext, onAnswer }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);

  const replace = (id: number, patch: Partial<Message>) => setMessages((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const ask = async () => {
    const question = input.trim();
    if (!question || busy) return;
    const context = attach ? getContext() : "";
    const pendingId = nextId++;
    setInput("");
    setBusy(true);
    setMessages((list) => [...list, { id: nextId++, who: "user", text: question }, { id: pendingId, who: "llm", text: "thinking…" }]);

    // Real assistant: POST /api/chat (OpenRouter via the server, no simulated replies) —
    // with the recent conversation so follow-ups like "why is that one worse?" resolve.
    const history = messages
      .filter((m) => m.text && m.text !== "thinking…" && m.text !== "…")
      .slice(-6)
      .map((m) => ({ role: m.who, text: m.text }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, context, history }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; reply?: { text?: string; via?: string } };
      if (res.ok && json.ok && json.reply?.text) {
        replace(pendingId, { text: json.reply.text, via: json.reply.via ?? "api/chat" });
        onAnswer?.(json.reply.text);
      } else {
        replace(pendingId, { via: "ERROR", text: `No answer produced — ${json.error ?? json.reply?.text ?? `HTTP ${res.status}`}.` });
      }
    } catch (e) {
      replace(pendingId, { via: "OFFLINE", text: `/api/chat unreachable — ${e instanceof Error ? e.message : "network error"}.` });
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="flex h-[260px] flex-col gap-2.5 overflow-y-auto rounded-lg border bg-bg p-3 text-[11px]" aria-live="polite">
        {messages.length === 0 && <EmptyState>Ask e.g. “{example}”</EmptyState>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cx(
              "max-w-[90%] border px-2.5 py-2 whitespace-pre-wrap",
              m.who === "user" ? "self-end border-line-lit bg-panel-hi" : "self-start border-cloud-line bg-cloud-bg",
            )}
          >
            <div className="mb-1 text-[9px] tracking-[1.5px] text-dim">{m.who === "user" ? "YOU" : `LLM${m.via ? ` · via ${m.via}` : ""}`}</div>
            {m.text}
          </div>
        ))}
      </div>
      <Check checked={attach} onChange={setAttach}>
        {contextLabel}
      </Check>
      <form
        className="mt-2 flex flex-wrap gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <Input aria-label="Question for the LLM" className="min-w-[180px] flex-1" value={input} placeholder={placeholder} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" disabled={busy || !input.trim()}>
          Ask
        </Button>
      </form>
      <div className="mt-2 flex items-center justify-between gap-2.5">
        <Button variant="secondary" size="sm" onClick={() => setMessages([])}>
          Clear chat
        </Button>
        <span className="text-[10px] text-dim2">POST /api/chat · OpenRouter</span>
      </div>
    </div>
  );
}

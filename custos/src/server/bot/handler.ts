/**
 * The bot's brain — full task loop (M3 slice, in from the user's demo brief):
 * tasks → (one) list or direct proof start → media (photo/video/audio/PDF) →
 * typed full-name signature → done → supervisor's desk. Live conversation
 * states memory nothing — every flow survives restarts and TTLs after 30 min.
 * Rule: never an error; menu is always one word away (§4.8).
 */
import { BOT_BUTTONS, BOT_MESSAGES } from "@/lib/bot/messages";
import { getDb, type AppDb } from "@/server/db/client";
import { orgsRepo } from "@/server/repos/base";
import { kindForMediaId } from "@/server/messaging/media-store";
import { tasksService } from "@/server/services/tasks";
import { conversationStateService } from "@/server/bot/state";
import type { Person, Task } from "@/server/db/schema";
import type { BotReply, InboundEvent, WaButton } from "@/server/messaging/types";

type Intent = "menu" | "start" | "help" | "tasks" | "problem" | "proof";

const KEYWORDS: Record<string, Intent> = {
  start: "start",
  help: "help",
  tasks: "tasks",
  "wetin i get today": "tasks",
  "wetin i get": "tasks",
  problem: "problem",
  wahala: "problem",
  proof: "proof",
  status: "proof",
  "team status": "proof",
};

const BUTTON_INTENTS: Record<string, Intent> = {
  show_tasks: "tasks",
  report_problem: "problem",
  proof: "proof",
  help: "help",
};

const MENU_WORDS = ["menu", "hi", "hello", "hey", "goodmorning"];

/** Role-based menus (§4.2): the heads get the team pulse; staff get problem reports. */
export function menuFor(person: Person): WaButton[] {
  if (person.role === "owner" || person.role === "supervisor") {
    return [BOT_BUTTONS.showTasks, BOT_BUTTONS.teamStatus, BOT_BUTTONS.help];
  }
  return [BOT_BUTTONS.showTasks, BOT_BUTTONS.reportProblem, BOT_BUTTONS.help];
}

const KIND_HUMAN: Record<string, string> = {
  photo: "Photo",
  video: "Video",
  audio: "Voice note",
  document: "Document",
};

export async function respondTo(person: Person, ev: InboundEvent): Promise<BotReply[]> {
  const raw = (ev.body ?? "").trim();
  const lower = raw.toLowerCase();

  // Global escape hatch: the menu word resets any mid-flow state (§4.8).
  if ((ev.type === "text" && MENU_WORDS.includes(lower)) || (ev.type === "button" && ev.buttonId === "menu")) {
    await conversationStateService.reset(person.id, person.organizationId);
    return [{ kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuFor(person) }];
  }

  const state = await conversationStateService.get(person.id);

  /* ---------------------------- live flows ---------------------------- */

  if (state.state === "awaiting_task_choice" && ev.type === "button" && ev.buttonId?.startsWith("task:")) {
    const task = await tasksService.byId(ev.buttonId.slice(5));
    if (task && task.assigneeId === person.id && task.status !== "done") {
      return startProof(person, task);
    }
    // stale/foreign tap → falls through to the backbone menu below
  }

  if (state.state === "awaiting_media" && ev.type === "media") {
    const taskId = (state.context as { taskId?: string }).taskId;
    const task = taskId ? await tasksService.byId(taskId) : null;
    if (task && task.assigneeId === person.id && task.status !== "done" && ev.mediaId) {
      const kind = await kindForMediaId(ev.mediaId);
      if (kind) {
        await tasksService.recordMediaEvidence(person, task.id, ev.mediaId, kind);
        if ((task.evidenceSpec ?? []).includes("signature")) {
          await conversationStateService.set(person.id, person.organizationId, "awaiting_signature", {
            taskId: task.id,
          });
          return [
            { kind: "text", text: BOT_MESSAGES.mediaReceived(KIND_HUMAN[kind] ?? "Media") },
            { kind: "text", text: BOT_MESSAGES.askSignature(task.title ?? "your task") },
          ];
        }
        await tasksService.markDone(task, person);
        await conversationStateService.reset(person.id, person.organizationId);
        return [{ kind: "text", text: BOT_MESSAGES.taskDone(task.title ?? "your task") }];
      }
    }
    if (task && task.assigneeId === person.id && task.status !== "done") {
      // Not a usable media id — ask again, honestly.
      return [{ kind: "text", text: BOT_MESSAGES.askMedia(task.title ?? "your task", task.instructions ?? undefined) }];
    }
  }

  if (state.state === "awaiting_signature" && ev.type === "text" && raw.length >= 3) {
    const taskId = (state.context as { taskId?: string }).taskId;
    const task = taskId ? await tasksService.byId(taskId) : null;
    if (task && task.assigneeId === person.id && task.status !== "done") {
      await tasksService.recordSignatureEvidence(person, task.id, raw);
      await tasksService.markDone(task, person);
      await conversationStateService.reset(person.id, person.organizationId);
      return [{ kind: "text", text: BOT_MESSAGES.taskDone(task.title ?? "your task") }];
    }
  }

  /* -------------------------- keyword backbone -------------------------- */

  const intent: Intent | null =
    ev.type === "button" ? (BUTTON_INTENTS[ev.buttonId ?? ""] ?? null) : (KEYWORDS[lower] ?? null);

  switch (intent) {
    case "start": {
      const org = await (async () => {
        const db = (await getDb()) as AppDb;
        return orgsRepo.byId(db, person.organizationId);
      })();
      return [
        { kind: "text", text: BOT_MESSAGES.welcome(person.name, person.role, org?.name ?? "your workplace") },
        { kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuFor(person) },
      ];
    }
    case "help":
      return [
        { kind: "text", text: BOT_MESSAGES.help },
        { kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuFor(person) },
      ];
    case "tasks":
      return handleTasks(person);
    case "proof": {
      const counts = await tasksService.countsLast24h({ orgId: person.organizationId });
      return [{ kind: "text", text: BOT_MESSAGES.proofSummary(counts.done, counts.waiting) }];
    }
    case "problem":
      // M5 replaces this stub with the problem flow (media → asset → job).
      return [{ kind: "text", text: BOT_MESSAGES.problemStub }];
    default:
      // Unknown text: the menu, never an error (§4.8).
      return [{ kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuFor(person) }];
  }
}

async function handleTasks(person: Person): Promise<BotReply[]> {
  const open = await tasksService.listOpen(person.id);
  if (open.length === 0) return [{ kind: "text", text: BOT_MESSAGES.tasksEmpty }];
  if (open.length === 1 && open[0]) return startProof(person, open[0]);
  await conversationStateService.set(person.id, person.organizationId, "awaiting_task_choice", {});
  return [
    {
      kind: "list",
      text: BOT_MESSAGES.pickTask(open.length),
      sections: [
        {
          title: "Your tasks",
          rows: open.map((t) => ({
            id: `task:${t.id}`,
            title: t.title ?? "Task",
            description: t.instructions ?? undefined,
          })),
        },
      ],
    },
  ];
}

/** Enter the proof flow for a task: media first (if demanded), then signature. */
async function startProof(person: Person, task: Task): Promise<BotReply[]> {
  const spec = task.evidenceSpec ?? [];
  if (spec.includes("media")) {
    await conversationStateService.set(person.id, person.organizationId, "awaiting_media", { taskId: task.id });
    return [{ kind: "text", text: BOT_MESSAGES.askMedia(task.title ?? "your task", task.instructions ?? undefined) }];
  }
  if (spec.includes("signature")) {
    await conversationStateService.set(person.id, person.organizationId, "awaiting_signature", { taskId: task.id });
    return [{ kind: "text", text: BOT_MESSAGES.askSignature(task.title ?? "your task") }];
  }
  // Nothing demanded — a plain confirmation closes it.
  await tasksService.markDone(task, person);
  await conversationStateService.reset(person.id, person.organizationId);
  return [{ kind: "text", text: BOT_MESSAGES.taskDone(task.title ?? "your task") }];
}

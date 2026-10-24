/**
 * The bot's brain, M1 slice (brief §4). Keyword map includes the Pidgin
 * synonyms; button taps land here as button intents. The M1 promise:
 * never an error, always the menu (§4.8); STOP/consent flips belong to M2 in
 * the pipeline, task flows to M3, problems to M5 — each leaves a marked stub
 * reply so demo users see an honest message, not a dead end.
 */
import { BOT_BUTTONS, BOT_MESSAGES } from "@/lib/bot/messages";
import { getDb, type AppDb } from "@/server/db/client";
import { orgsRepo } from "@/server/repos/base";
import type { Person } from "@/server/db/schema";
import type { BotReply, InboundEvent, WaButton } from "@/server/messaging/types";

type Intent = "menu" | "start" | "help" | "tasks" | "problem";

const KEYWORDS: Record<string, Intent> = {
  menu: "menu",
  hi: "menu",
  hello: "menu",
  hey: "menu",
  goodmorning: "menu",
  start: "start",
  help: "help",
  tasks: "tasks",
  "wetin i get today": "tasks",
  "wetin i get": "tasks",
  problem: "problem",
  wahala: "problem",
};

const BUTTON_INTENTS: Record<string, Intent> = {
  show_tasks: "tasks",
  report_problem: "problem",
  help: "help",
};

function menuButtons(): WaButton[] {
  return [BOT_BUTTONS.showTasks, BOT_BUTTONS.reportProblem, BOT_BUTTONS.help];
}

export async function respondTo(person: Person, ev: InboundEvent): Promise<BotReply[]> {
  const raw = (ev.body ?? "").trim().toLowerCase();
  const intent: Intent | null =
    ev.type === "button" ? (BUTTON_INTENTS[ev.buttonId ?? ""] ?? null) : (KEYWORDS[raw] ?? null);

  const org = await (async () => {
    const db = (await getDb()) as AppDb;
    return orgsRepo.byId(db, person.organizationId);
  })();
  const orgName = org?.name ?? "your workplace";

  switch (intent) {
    case "start":
      // M2 flips consent here; M1 greets already-registered numbers warmly.
      return [
        { kind: "text", text: BOT_MESSAGES.welcome(person.name, person.role, orgName) },
        { kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuButtons() },
      ];
    case "help":
      return [
        { kind: "text", text: BOT_MESSAGES.help },
        { kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuButtons() },
      ];
    case "tasks":
      // M3 replaces this stub with the live list message.
      return [{ kind: "text", text: BOT_MESSAGES.tasksEmpty }];
    case "problem":
      // M5 replaces this stub with the problem flow (text/photo → asset → job).
      return [{ kind: "text", text: BOT_MESSAGES.problemStub }];
    case "menu":
      return [{ kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuButtons() }];
    default:
      // Unknown text: the menu, never an error (§4.8).
      return [{ kind: "buttons", text: BOT_MESSAGES.menu, buttons: menuButtons() }];
  }
}

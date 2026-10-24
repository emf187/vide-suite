/**
 * THE one file carrying every WhatsApp-facing string (brief §15). Wording is
 * edited, translated and submitted for Meta template approval HERE and only
 * here. Tone rules: short, friendly, plain English (+ a few Pidgin keywords
 * recognized in the handler, written here only where they are echoed).
 * One action per message. Never more than three buttons. Never blame.
 */

export const BOT_MESSAGES = {
  /** Unregistered number: ONE polite reply, nothing else after (§4.1). */
  unregistered:
    "Hello! This number is not registered yet. Please ask your supervisor to add you, then send START to begin.",

  /** First contact AFTER START (roles come from the registry, not the person's phone). */
  welcome: (name: string, role: string, org: string): string =>
    `Hello ${name}! You are registered as ${role} at ${org}. ` +
    "I bring you your tasks and take your answers — photos and numbers go straight back to your supervisor.",

  /** The repeat menu (§4.8: unknown text never errors, it returns here). */
  menu: "I watch your tasks and take your answers. What do you need?",

  help:
    "Here is how I work:\n" +
    "• tasks — see what you have today\n" +
    "• problem — report a problem (or the word 'wahala')\n" +
    "• menu — come back here any time\n" +
    "Your supervisor sees every answer you send.",

  /** M3 fills the real list; until then this stays honest and useful. */
  tasksEmpty:
    "You have no tasks right now. I will message you the moment one is set.",

  /** M5 fills the problem flow; the human path stays open meanwhile. */
  problemStub:
    "Photo problem reports are coming soon. For now, tell your supervisor directly — that always works.",

  /** A template Meta has not approved — honest, short. */
  noTasksToday: (name: string): string => `Good day ${name}. You have no tasks today.`,
} as const;

/** Quick-reply / button labels — keep count ≤ 3 per message (§4). */
export const BOT_BUTTONS = {
  showTasks: { id: "show_tasks", label: "Show my tasks" },
  reportProblem: { id: "report_problem", label: "Report a problem" },
  help: { id: "help", label: "Help" },
} as const;

/** Approved-template renderers (M7 will submit these names). One per person per day (§4.2). */
export const TEMPLATES: Record<string, (v: Record<string, string>) => string> = {
  daily_task_summary: (v) =>
    `Good morning ${v.name}. You have ${v.count} task${Number(v.count) === 1 ? "" : "s"} today at ${v.business}.`,
  task_reminder: (v) => `Reminder: ${v.title} is due (${v.due}). Please send your answer.`,
  escalation_notice: (v) => `Still waiting: ${v.title} (${v.assignee}) is now ${v.hours} hour(s) late.`,
};

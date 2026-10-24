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

  /** Registered but never opted in: the person still owns consent (§4.1). */
  askStart: "Hello! This number is registered but not started yet. Reply START to begin.",

  /** First contact AFTER START (roles come from the registry, not the phone). */
  welcome: (name: string, role: string, org: string): string =>
    `Hello ${name}! You are registered as ${role} at ${org}. ` +
    "I bring you your tasks and take your answers — photos, video, voice notes and signatures go straight back to your supervisor.",

  /** The repeat menu (§4.8: unknown text never errors, it returns here). */
  menu: "I watch your tasks and take your answers. What do you need?",

  help:
    "Here is how I work:\n" +
    "• tasks — see what you have today\n" +
    "• proof — send photos, video or voice notes as proof\n" +
    "• signature — reply with your full name to sign off\n" +
    "• problem — report a problem (or the word 'wahala')\n" +
    "• menu — come back here any time\n" +
    "Your supervisor sees every answer you send.",

  /** No work right now — honest and useful. */
  tasksEmpty:
    "You have no tasks right now. I will message you the moment one is set.",

  pickTask: (n: number): string =>
    `You have ${n} tasks waiting. Tap one to start proof:`,

  askMedia: (title: string, instructions?: string): string =>
    `Task: ${title}${instructions ? `\n${instructions}` : ""}\n\nPlease send one item as proof — a photo, video, voice note or PDF.`,

  mediaReceived: (kind: string): string => `✅ ${kind} received.`,

  askSignature: (title: string): string =>
    `Last step: reply with your FULL NAME to sign "${title}" off.`,

  retrySignature:
    "That didn't look like a name. Reply with your full name (or send menu to start over).",

  taskDone: (title: string): string =>
    `Done! "${title}" is signed and on your supervisor's desk. Thank you.`,

  taskPushed: (title: string, instructions: string | undefined, due: string): string =>
    `New task: ${title}${instructions ? `\n${instructions}` : ""}\nDue: ${due}.\nTap below to start proof.`,

  proofSummary: (done: number, waiting: number): string =>
    `Team status — last 24 h: ${done} task${done === 1 ? "" : "s"} done, ${waiting} waiting. Send menu for your options.`,

  /** The final message after STOP — then true silence (§4.1). */
  stoppedConfirm:
    "You are opted out. You will receive nothing further from me. Send START to rejoin (or ask your supervisor).",

  /** M5 fills the problem flow; the human path stays open meanwhile. */
  problemStub:
    "Photo problem reports are coming soon. For now, tell your supervisor directly — that always works.",

  noTasksToday: (name: string): string => `Good day ${name}. You have no tasks today.`,
} as const;

/** Quick-reply / button labels — never more than three per message (§4). */
export const BOT_BUTTONS = {
  showTasks: { id: "show_tasks", label: "Show my tasks" },
  reportProblem: { id: "report_problem", label: "Report a problem" },
  teamStatus: { id: "proof", label: "Team status" },
  help: { id: "help", label: "Help" },
  /** Per-task quick start — id carries the task through the tap. */
  startProof: (taskId: string) => ({ id: `task:${taskId}`, label: "Start proof" }),
} as const;

/** Approved-template renderers (M7 will submit these names). One per person per day (§4.2). */
export const TEMPLATES: Record<string, (v: Record<string, string>) => string> = {
  daily_task_summary: (v) =>
    `Good morning ${v.name}. You have ${v.count} task${Number(v.count) === 1 ? "" : "s"} today at ${v.business}.`,
  task_reminder: (v) => `Reminder: ${v.title} is due (${v.due}). Please send your answer.`,
  escalation_notice: (v) => `Still waiting: ${v.title} (${v.assignee}) is now ${v.hours} hour(s) late.`,
};

/**
 * Suite login users — deliberately env-configured so the app stays deployable
 * without a database. VIDE_LOGIN_USERS is JSON: [{"email":"...","password":"...","name":"..."}].
 * A sensible demo user exists for local development only.
 */
export type SuiteUser = { email: string; password: string; name: string };

const DEFAULT_DEV_USERS: SuiteUser[] = [
  { email: "mikedeimu@gmail.com", password: "cortex-maple-77", name: "Mike Edeimu" },
];

export function getSuiteUsers(): SuiteUser[] {
  const raw = process.env.VIDE_LOGIN_USERS;
  if (!raw) return DEFAULT_DEV_USERS;
  try {
    const parsed = JSON.parse(raw) as SuiteUser[];
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed.filter((u) => typeof u?.email === "string" && typeof u?.password === "string");
  } catch (err) {
    console.error("[vide] VIDE_LOGIN_USERS is not valid JSON — falling back to the dev user.", err instanceof Error ? err.message : err);
    return DEFAULT_DEV_USERS;
  }
}

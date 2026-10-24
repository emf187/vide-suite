"use server";

import { redirect } from "next/navigation";
import { getCtx } from "@/server/ctx";
import { normalizePhone, personsService } from "@/server/services/persons";
import type { Role } from "@/lib/shared/types";

const ROLES: Role[] = ["owner", "supervisor", "staff", "technician"];

/**
 * The heads' intake: register a colleague. Admission only — CONSENT always
 * belongs to the person: they reply START from their own.number (§4.1).
 */
export async function registerPersonAction(formData: FormData): Promise<never> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "staff").trim() as Role;
  const phoneRaw = String(formData.get("phone") ?? "").trim();

  if (name.length < 2 || !ROLES.includes(role) || !/^\+?[0-9\s-]{7,15}$/.test(phoneRaw.replace(/\s/g, " "))) {
    redirect("/people?error=fields");
  }

  try {
    await personsService.register(ctx, { name, role, phone: normalizePhone(phoneRaw) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "phone_conflict" || message === "bad_role") redirect("/people?error=phone_conflict");
    throw err;
  }
  redirect("/people?ok=1");
}

/** Re-open consent for a stopped person: set back to pending → they send START. */
export async function reactivateAction(formData: FormData): Promise<never> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");

  const personId = String(formData.get("personId") ?? "").trim();
  const person = personId ? await personsService.byId(personId) : null;
  if (!person || person.organizationId !== ctx.orgId) redirect("/people?error=fields");

  await personsService.setConsent(ctx, person!.phoneE164, "pending");
  redirect("/people?ok=reopened");
}

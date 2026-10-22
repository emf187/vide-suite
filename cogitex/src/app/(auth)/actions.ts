"use server";

import { redirect } from "next/navigation";
import { signInSchema, signUpSchema } from "@/lib/shared/validators";
import { verifyPassword } from "@/server/auth/password";
import {
  clearSessionCookie,
  createSessionToken,
  setSessionCookie,
} from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { usersRepo } from "@/server/repos/users";
import { createAccount } from "@/server/services/accounts";

/** Sign-up: validate → service transaction → session cookie → console. */
export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = signUpSchema.safeParse({
    orgName: String(formData.get("orgName") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    redirect("/signup?error=fields");
  }
  const db = await getDb();

  const result = await createAccount(db, parsed.data);
  if (result.kind !== "created") {
    redirect(result.kind === "email_conflict" ? "/signup?error=email_taken" : "/signup?error=slug_taken");
  }

  await setSessionCookie(await createSessionToken(result.user.id));
  redirect("/today");
}

export async function signInAction(formData: FormData): Promise<void> {
  const parsed = signInSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) {
    redirect("/login?error=fields");
  }
  const { email, password } = parsed.data;
  const db = await getDb();

  const identity = await usersRepo.getPasswordIdentity(db, email);
  if (!identity || !identity.passwordHash) {
    redirect("/login?error=invalid");
  }
  const ok = await verifyPassword(password, identity.passwordHash);
  if (!ok) {
    redirect("/login?error=invalid");
  }
  const user = await usersRepo.findById(db, identity.userId);
  if (!user || (await usersRepo.isDeactivated(db, user.id))) {
    redirect("/login?error=deactivated");
  }

  await setSessionCookie(await createSessionToken(user.id));
  redirect("/today");
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

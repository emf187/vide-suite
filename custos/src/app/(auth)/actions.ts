"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSessionToken } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/constants";
import { getDb } from "@/server/db/client";
import { createAccount, verifySignIn } from "@/server/services/accounts";

const signUpSchema = z.object({
  orgName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  industry: z.string().optional(), // whitelist-validated inside createAccount
});
const signInSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(100) });

async function startSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function signUpAction(formData: FormData): Promise<never> {
  const parsed = signUpSchema.safeParse({
    orgName: formData.get("orgName"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    industry: formData.get("industry"),
  });
  if (!parsed.success) redirect("/signup?error=fields");

  const db = await getDb();
  const result = await createAccount(db, parsed.data);
  if (result.kind !== "created") {
    // M0: an existing email can never be overwritten — always bounced back with a polite error.
    redirect("/signup?error=email_taken");
  }
  await startSession(result.user.id);
  redirect("/today");
}

export async function signInAction(formData: FormData): Promise<never> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=fields");

  const db = await getDb();
  const user = await verifySignIn(db, parsed.data.email, parsed.data.password);
  if (!user) redirect("/login?error=invalid");
  await startSession(user.id);
  redirect("/today");
}

export async function signOutAction(): Promise<never> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

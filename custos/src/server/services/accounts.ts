import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import type { Organization, User } from "@/server/db/schema";
import { passwordResetTokens } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { membershipsRepo, orgsRepo, usersRepo } from "@/server/repos/base";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { slugify } from "@/lib/shared/slugify";

export type CreateAccountInput = { orgName: string; fullName: string; email: string; password: string };
export type CreateAccountResult = { kind: "created"; user: User; organization: Organization } | { kind: "email_conflict" };

/**
 * Account creation — INSERT-only by construction (the M0 rule, in from day
 * one): a signup with an existing email is refused untouched. One transaction
 * creates user + org + owner membership + audit trail.
 */
export async function createAccount(db: AppDb, input: CreateAccountInput): Promise<CreateAccountResult> {
  const passwordHash = await hashPassword(input.password);
  const base = slugify(input.orgName);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      return await db.transaction(async (tx) => {
        const user = await usersRepo.create(tx, { name: input.fullName, email: input.email, passwordHash });
        const organization = await orgsRepo.create(tx, { name: input.orgName, slug });
        await membershipsRepo.create(tx, { organizationId: organization.id, userId: user.id, role: "owner" });
        await auditRepo.log(tx, {
          organizationId: organization.id,
          actorUserId: user.id,
          action: "org.created",
          entity: "organization",
          entityId: organization.id,
          after: { name: organization.name, slug: organization.slug },
        });
        return { kind: "created" as const, user, organization };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("users_email_key")) return { kind: "email_conflict" };
      if (message.includes("organizations_slug_key")) continue;
      throw err;
    }
  }
  return { kind: "email_conflict" };
}

/* ------------------------------------------------------------------ */
/* Password resets — expiring, single-use, hash-at-rest (M0 standard)  */
/* ------------------------------------------------------------------ */

const RESET_TTL_MINUTES = 30;

function tokenId(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function requestPasswordReset(db: AppDb, email: string): Promise<{ token: string; expiresAt: Date } | null> {
  const user = await usersRepo.findByEmail(db, email);
  if (!user) return null;
  if (await usersRepo.isDeactivated(db, user.id)) return null;
  const identity = await usersRepo.getPasswordIdentity(db, user.email);
  if (!identity?.passwordHash) return null;

  const now = new Date();
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash: tokenId(token), expiresAt });

  // Delivery stub — swap for the mailer when SMTP/provider env exists.
  console.info("[custos] PASSWORD RESET LINK (delivery pending mailer — stub): /reset?token=" + token);
  return { token, expiresAt };
}

export async function confirmPasswordReset(db: AppDb, token: string, newPassword: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenId(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return false;
  const hash = await hashPassword(newPassword);
  await usersRepo.setPasswordHash(db, row.userId, hash);
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
  return true;
}

/** Sign-in helper (verify against the stored password identity). */
export async function verifySignIn(db: AppDb, email: string, password: string): Promise<User | null> {
  const identity = await usersRepo.getPasswordIdentity(db, email);
  if (!identity?.passwordHash) return null;
  if (!(await verifyPassword(password, identity.passwordHash))) return null;
  const user = await usersRepo.findById(db, identity.userId);
  if (!user || user.deactivatedAt) return null;
  return user;
}

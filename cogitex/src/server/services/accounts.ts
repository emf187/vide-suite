import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, eq, isNull, gt } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import type { Organization, User } from "@/server/db/schema";
import { passwordResetTokens } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { membershipsRepo } from "@/server/repos/memberships";
import { orgsRepo } from "@/server/repos/orgs";
import { usersRepo } from "@/server/repos/users";
import { hashPassword } from "@/server/auth/password";

export type CreateAccountInput = {
  orgName: string;
  fullName: string;
  email: string;
  password: string;
};

export type CreateAccountResult =
  | { kind: "created"; user: User; organization: Organization }
  | { kind: "email_conflict" };

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "org";
}

/**
 * Sign-up service: creates the user (with credential), the organization and the owner
 * membership in ONE transaction; retries with a fresh slug suffix on collision.
 * (The auth action layer only validates input and sets the session cookie.)
 */
export async function createAccount(
  db: AppDb,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  const passwordHash = await hashPassword(input.password);
  const base = slugify(input.orgName);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomUUID().slice(0, 4)}`;
    try {
      return await db.transaction(async (tx) => {
        const user = await usersRepo.create(tx, {
          name: input.fullName,
          email: input.email,
          passwordHash,
        });
        const organization = await orgsRepo.create(tx, { name: input.orgName, slug });
        await membershipsRepo.create(tx, {
          organizationId: organization.id,
          userId: user.id,
          role: "owner",
        });
        await auditRepo.log(tx, {
          organizationId: organization.id,
          actorUserId: user.id,
          action: "org.created",
          entityType: "organization",
          entityId: organization.id,
          diff: { name: organization.name, slug: organization.slug },
        });
        await auditRepo.log(tx, {
          organizationId: organization.id,
          actorUserId: user.id,
          action: "user.signed_up",
          entityType: "user",
          entityId: user.id,
        });
        return { kind: "created" as const, user, organization };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("users_email_key") || message.includes("user_auth_identities_provider_subject_key")) {
        return { kind: "email_conflict" };
      }
      if (message.includes("organizations_slug_key")) {
        continue;
      }
      throw err;
    }
  }
  // After 5 slug attempts, force a random slug rather than fail the signup.
  const slug = `${base}-${randomUUID().slice(0, 8)}`;
  return await db.transaction(async (tx) => {
    const user = await usersRepo.create(tx, {
      name: input.fullName,
      email: input.email,
      passwordHash,
    });
    const organization = await orgsRepo.create(tx, { name: input.orgName, slug });
    await membershipsRepo.create(tx, {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
    });
    await auditRepo.log(tx, {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "org.created",
      entityType: "organization",
      entityId: organization.id,
    });
    return { kind: "created" as const, user, organization };
  });
}

/* ------------------------------------------------------------------ */
/* M0 security: expiring, single-use password reset tokens             */
/* ------------------------------------------------------------------ */

const RESET_TTL_MINUTES = 30;

function tokenId(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Start a password reset: mints an expiring single-use token (hash at rest)
 * and burns any previous unused tokens for the user. Delivery (email) is
 * STUBBED for now — clearly marked until a mailer is configured; the caller
 * receives the raw link token exactly as an email body would carry it.
 * Unknown / deactivated / non-password accounts get a silent null — the
 * response never reveals whether an email belongs to an account.
 */
export async function requestPasswordReset(
  db: AppDb,
  email: string,
): Promise<{ token: string; expiresAt: Date } | null> {
  const user = await usersRepo.findByEmail(db, email);
  if (!user) return null;
  if (await usersRepo.isDeactivated(db, user.id)) return null;
  const identity = await usersRepo.getPasswordIdentity(db, user.email);
  if (!identity?.passwordHash) return null; // SSO-only account — no credential to reset

  const now = new Date();
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60_000);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: tokenId(token),
    expiresAt,
  });

  // Delivery stub — swap for the mailer when SMTP/provider env exists.
  console.info(
    "[cogitex] PASSWORD RESET LINK (delivery pending mailer — stub): /reset?token=" + token,
  );

  return { token, expiresAt };
}

/**
 * Complete a password reset: token must be unused and unexpired. Marks it
 * consumed and updates ONLY that account's password-identity hash. Returns
 * false for unknown/expired/reused tokens with no distinct error surface.
 */
export async function confirmPasswordReset(
  db: AppDb,
  token: string,
  newPassword: string,
): Promise<boolean> {
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

import { randomUUID } from "node:crypto";
import type { AppDb } from "@/server/db/client";
import type { Organization, User } from "@/server/db/schema";
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

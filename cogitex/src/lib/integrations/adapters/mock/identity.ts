import type { ExternalActorBind, IdentityClient, OrgMember, SessionContext } from "@/lib/integrations/interfaces";

/**
 * Mock IdentityClient placeholder. The built-in auth (email+password via session cookie)
 * is implemented directly in src/server/auth + src/server/ctx and does NOT go through this
 * interface — it exists so a future VIDE shared-SSO adapter can slot in with zero UI changes
 * (see docs/ARCHITECTURE.md §4 and INTEGRATION_CONTRACTS.md §8).
 */
export class MockIdentityClient implements IdentityClient {
  async authenticate(): Promise<SessionContext> {
    throw new Error("identity mock: authentication is handled by the built-in session auth in M0");
  }

  async listUsers(orgId: string): Promise<OrgMember[]> {
    return []; // org-scoped member lists come from membershipsRepo in M0
  }

  async registerExternalActor(input: { marketplaceTechnicianId: string }): Promise<ExternalActorBind> {
    throw new Error(`identity mock: external actor binding not active yet (${input.marketplaceTechnicianId})`);
  }
}

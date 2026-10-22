import type {
  CortexClient,
  IdentityClient,
  MarketplaceClient,
  NotificationClient,
  VideClient,
} from "./interfaces";
import { MockCortexClient } from "./adapters/mock/cortex";
import { MockIdentityClient } from "./adapters/mock/identity";
import { MockMarketplaceClient } from "./adapters/mock/marketplace";
import { MockNotificationClient } from "./adapters/mock/notification";
import { MockVideClient } from "./adapters/mock/vide";

export type IntegrationProfile = "mock" | "real";

export type Integrations = {
  vide: VideClient;
  cortex: CortexClient;
  marketplace: MarketplaceClient;
  notifications: NotificationClient;
  identity: IdentityClient;
  profile: IntegrationProfile;
};

const globalStore = globalThis as unknown as { __cogitexIntegrations?: Integrations };

/**
 * Single source of truth for service access. Defaults to mocks; set INTEGRATION_PROFILE=real
 * and the individual *_*_BASE_URL env vars to swap a real service in (docs/INTEGRATION_CONTRACTS.md §1).
 */
export function getIntegrations(): Integrations {
  if (globalStore.__cogitexIntegrations) return globalStore.__cogitexIntegrations;

  const wantsReal = process.env.INTEGRATION_PROFILE === "real";
  const videUrl = process.env.VIDE_API_BASE_URL;
  let profile: IntegrationProfile = "mock";

  let vide: VideClient = new MockVideClient();
  let cortex: CortexClient = new MockCortexClient();
  const marketplace: MarketplaceClient = new MockMarketplaceClient();
  const notifications: NotificationClient = new MockNotificationClient();
  const identity: IdentityClient = new MockIdentityClient();

  if (wantsReal && videUrl) {
    // Real VIDE adapter implements the VERIFIED subset only.
    const { RealVideClient } = require("./adapters/real/vide") as { RealVideClient: new (base: string) => VideClient };
    vide = new RealVideClient(videUrl);
    profile = "real";
    console.warn("[cogitex] INTEGRATION_PROFILE=real — VIDE VERIFIED endpoints active; proposed endpoints still raise until VIDE ships them.");
  } else if (wantsReal && !videUrl) {
    console.warn("[cogitex] INTEGRATION_PROFILE=real but VIDE_API_BASE_URL is unset — continuing with mocks.");
  }

  const integrations: Integrations = { vide, cortex, marketplace, notifications, identity, profile };
  globalStore.__cogitexIntegrations = integrations;
  return integrations;
}

/** Test/demo helper: reset the singleton (used by integration tests). */
export function __resetIntegrations(): void {
  globalStore.__cogitexIntegrations = undefined;
}

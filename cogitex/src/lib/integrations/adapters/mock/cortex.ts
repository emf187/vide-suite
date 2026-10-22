import type {
  ConfirmedRootCauseInput,
  CortexClient,
  RulEstimate,
} from "@/lib/integrations/interfaces";
import { MOCK_NOW } from "./fixtures";

/**
 * Mock CortexClient — deterministic RUL for the demo machines and a recorded
 * root-cause write-back log (the "improve fault models" feedback loop of the brief §5.3).
 */
export class MockCortexClient implements CortexClient {
  /** All confirmed root causes pushed back (for tests + demo inspection). */
  confirmedRootCauses: ConfirmedRootCauseInput[] = [];

  async getRulEstimate(machineName: string): Promise<RulEstimate | null> {
    if (machineName === "PUMP-3") {
      return {
        estimateHours: 64,
        uncertaintyHours: 20,
        basis: "model",
        topFactors: ["Vibration 2x rising", "Bearing temperature drift"],
        asOf: MOCK_NOW,
      };
    }
    if (machineName === "COMP-1") {
      return { estimateHours: 12, uncertaintyHours: 6, basis: "rules", topFactors: ["Discharge overtemperature"], asOf: MOCK_NOW };
    }
    return null;
  }

  async sendConfirmedRootCause(input: ConfirmedRootCauseInput): Promise<void> {
    this.confirmedRootCauses.push({ ...input });
  }
}

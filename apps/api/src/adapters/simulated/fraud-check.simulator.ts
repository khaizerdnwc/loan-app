import type { ApplicantIdentity, FraudAssessment, FraudCheck, FraudSignal } from "@loan/contracts";
import { ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

interface StoredFraud {
  flagged: boolean;
  signals: FraudSignal[];
}

const NO_SIGNALS: StoredFraud = { flagged: false, signals: [] };

/**
 * A simulated fraud check: the PRD's rules-based signals (§9.5) before a provider is chosen.
 * Answers come from `sim.persona_profile.fraud`, seeded per synthetic applicant; an unknown
 * applicant or one with no stored answer has no signals. No real fraud service is called.
 */
@Injectable()
export class SimulatedFraudCheck implements FraudCheck {
  readonly mode = ProviderMode.Simulated;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async assess(subject: ApplicantIdentity): Promise<FraudAssessment> {
    const mode = await applyFailureMode(ServiceName.Fraud, this.modes, this.options);
    const rows: { fraud: StoredFraud | null }[] = await this.ds.query(
      "SELECT fraud FROM sim.persona_profile WHERE applicant_id = $1",
      [subject.applicantId],
    );
    const stored = rows[0]?.fraud ?? NO_SIGNALS;
    const reply: Partial<FraudAssessment> = {
      flagged: stored.flagged,
      signals: [...stored.signals],
      provider: "Fraud signals (simulated)",
      mode: ProviderMode.Simulated,
      assessedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.flagged = undefined;
    return requireFields<FraudAssessment>(ServiceName.Fraud, reply, ["flagged", "signals"]);
  }
}

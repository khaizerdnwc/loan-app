import type { ApplicantIdentity, KycAml, ScreeningResult } from "@loan/contracts";
import { ProviderMode, ScreeningStage, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

interface StoredScreening {
  kycVerified: boolean;
  sanctionsMatch: boolean;
  matchedList: string | null;
  politicallyExposed: boolean;
  /**
   * The simulated watchlist adds this person after onboarding: screening at application is
   * clear, screening again before disbursement matches (PRD CMP-005).
   */
  listedBeforeDisbursement?: { matchedList: string };
}

/**
 * Simulated KYC and AML screening. Results come from `sim.persona_profile`; the list name
 * on a match is fictional ("Simulated watchlist"). No real list is queried (the mechanics
 * forbid real providers in this release). A persona the simulated list adds after onboarding
 * (`listedBeforeDisbursement`) is clear at application and matches before disbursement.
 */
@Injectable()
export class SimulatedKycAml implements KycAml {
  readonly mode = ProviderMode.Simulated;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async screen(
    subject: ApplicantIdentity,
    stage: ScreeningStage = ScreeningStage.Onboarding,
  ): Promise<ScreeningResult> {
    const mode = await applyFailureMode(ServiceName.KycAml, this.modes, this.options);
    const rows: { screening: StoredScreening }[] = await this.ds.query(
      "SELECT screening FROM sim.persona_profile WHERE applicant_id = $1",
      [subject.applicantId],
    );
    const stored: StoredScreening = rows[0]?.screening ?? {
      kycVerified: false,
      sanctionsMatch: false,
      matchedList: null,
      politicallyExposed: false,
    };
    const { listedBeforeDisbursement: laterListing, ...profile } = stored;
    const listedNow = stage === ScreeningStage.PreDisbursement ? laterListing : undefined;
    const reply: Partial<ScreeningResult> = {
      ...profile,
      ...(listedNow ? { sanctionsMatch: true, matchedList: listedNow.matchedList } : {}),
      provider: "KYC / AML screening (simulated)",
      mode: ProviderMode.Simulated,
      screenedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.sanctionsMatch = undefined;
    return requireFields<ScreeningResult>(ServiceName.KycAml, reply, [
      "kycVerified",
      "sanctionsMatch",
      "politicallyExposed",
    ]);
  }
}

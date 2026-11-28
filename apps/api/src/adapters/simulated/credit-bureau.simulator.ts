import type { ApplicantIdentity, BureauReport, CreditBureau } from "@loan/contracts";
import { ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

type StoredReport = Omit<BureauReport, "provider" | "mode" | "retrievedAt">;

const NO_HIT: StoredReport = {
  fileDepth: "NO_HIT",
  bureauScore: null,
  tradeLines: 0,
  utilisationPct: 0,
  delinquencies12m: 0,
  existingDefault: false,
  monthsOnFile: 0,
};

/**
 * A simulated credit bureau (PRD 9.5: "Simulator with sample reports for synthetic
 * personas"). Reports come from `sim.persona_profile`, seeded with synthetic applicants; an
 * unknown applicant is a no-hit, as at a real bureau.
 */
@Injectable()
export class SimulatedCreditBureau implements CreditBureau {
  readonly mode = ProviderMode.Simulated;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async pull(subject: ApplicantIdentity): Promise<BureauReport> {
    const mode = await applyFailureMode(ServiceName.CreditBureau, this.modes, this.options);
    const rows: { bureau: StoredReport }[] = await this.ds.query(
      "SELECT bureau FROM sim.persona_profile WHERE applicant_id = $1",
      [subject.applicantId],
    );
    const stored = rows[0]?.bureau ?? NO_HIT;
    const reply: Partial<BureauReport> = {
      ...stored,
      provider: "Credit bureau (simulated)",
      mode: ProviderMode.Simulated,
      retrievedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.fileDepth = undefined;
    return requireFields<BureauReport>(ServiceName.CreditBureau, reply, [
      "fileDepth",
      "tradeLines",
      "utilisationPct",
      "delinquencies12m",
      "existingDefault",
      "monthsOnFile",
    ]);
  }
}

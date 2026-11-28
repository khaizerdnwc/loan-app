import { createHash } from "node:crypto";
import type {
  ExternalDecision,
  ExternalDecisionEngine,
  ExternalDecisionReply,
  ExternalDecisionRequest,
} from "@loan/contracts";
import { Money, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

/**
 * The simulated client's own policy (synthetic, docs/ASSUMPTIONS.md "External decision
 * engine"): deliberately different from the built-in rule set, so the two can disagree.
 */
export const EXTERNAL_POLICY = {
  declineBelow: 560,
  approveFrom: 640,
  /** Existing obligations at most this share of income to approve. */
  maxObligationsRatio: "0.45",
} as const;

/** The simulated engine's decision for a request: a pure function, so a test can predict it. */
export function externalPolicy(r: ExternalDecisionRequest): {
  decision: ExternalDecision;
  reasonCodes: string[];
} {
  if (r.bureauScore === null) return { decision: "REFER", reasonCodes: ["EXT-NO-SCORE"] };
  const income = Money.of(r.monthlyIncome);
  if (income.isZero()) return { decision: "REFER", reasonCodes: ["EXT-NO-INCOME"] };
  if (r.bureauScore < EXTERNAL_POLICY.declineBelow) {
    return { decision: "DECLINE", reasonCodes: ["EXT-LOW-SCORE"] };
  }
  const obligationsOk = !Money.of(r.monthlyObligations).greaterThan(
    income.times(EXTERNAL_POLICY.maxObligationsRatio),
  );
  if (r.bureauScore >= EXTERNAL_POLICY.approveFrom && obligationsOk) {
    return { decision: "APPROVE", reasonCodes: [] };
  }
  return {
    decision: "REFER",
    reasonCodes: obligationsOk ? ["EXT-SCORE-REVIEW"] : ["EXT-HIGH-OBLIGATIONS"],
  };
}

/**
 * A simulated external decision engine (PRD DEC-008): stands in for a client that already
 * owns one. It applies `EXTERNAL_POLICY` to the request and labels its answer as simulated.
 * No real engine is called. Failure modes as every simulator (Engineering Standard 9).
 */
@Injectable()
export class SimulatedExternalDecisionEngine implements ExternalDecisionEngine {
  readonly mode = ProviderMode.Simulated;

  constructor(
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async evaluate(request: ExternalDecisionRequest): Promise<ExternalDecisionReply> {
    const mode = await applyFailureMode(ServiceName.ExternalDecision, this.modes, this.options);
    const answer = externalPolicy(request);
    const reply: Partial<ExternalDecisionReply> = {
      provider: "Client decision engine (simulated)",
      mode: ProviderMode.Simulated,
      decision: answer.decision,
      reasonCodes: answer.reasonCodes,
      // Stable for the same request, as a real engine's evaluation id would be per call.
      reference: `EXT-${createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 12).toUpperCase()}`,
      decidedAt: new Date().toISOString(),
    };
    if (mode === "MALFORMED") reply.decision = undefined;
    return requireFields<ExternalDecisionReply>(ServiceName.ExternalDecision, reply, [
      "decision",
      "reasonCodes",
      "reference",
    ]);
  }
}

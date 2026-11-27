import {
  type ApplicantIdentity,
  CREDIT_BUREAU,
  type CreditBureau,
  FRAUD_CHECK,
  type FraudCheck,
  isProviderUnavailable,
  KYC_AML,
  type KycAml,
} from "@loan/contracts";
import type { ReproduceResult } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { AutomationService } from "../automation/automation.service";
import {
  CURRENT_RULE_SET,
  CURRENT_SCORECARD,
  canonicalJson,
  type DecisionInputs,
  type DecisionResult,
  decide,
  hashInputs,
} from "../decisioning/engine";
import { CasesRepository } from "./cases.repository";
import type { DecisionRecordEntity } from "./entities/decision-record.entity";
import type { LoanCaseEntity } from "./entities/loan-case.entity";

/**
 * Runs the automated decision for a case (ADR 0022): gather every input through the ports
 * into one snapshot, decide with the current versions, store the record insert-only.
 * A provider that cannot answer becomes an UNAVAILABLE input — the engine then refers,
 * never declines (PRD NFR-005). The product's automation mode joins the snapshot inside the
 * decision's transaction (PRD §7.5), so the record says, and replays, what it ran under.
 */
@Injectable()
export class DecisionService {
  constructor(
    @Inject(CREDIT_BUREAU) private readonly bureau: CreditBureau,
    @Inject(KYC_AML) private readonly kycAml: KycAml,
    @Inject(FRAUD_CHECK) private readonly fraud: FraudCheck,
    private readonly repo: CasesRepository,
    private readonly automation: AutomationService,
  ) {
    // A decision record holds one provider mode; mixing a real and a simulated provider
    // would make it ambiguous, so that wiring is refused at boot.
    if (bureau.mode !== kycAml.mode || bureau.mode !== fraud.mode) {
      throw new Error(
        `Credit bureau (${bureau.mode}), KYC/AML (${kycAml.mode}) and fraud check (${fraud.mode}) must run in the same provider mode.`,
      );
    }
  }

  async gatherInputs(c: LoanCaseEntity, asOfDate: string): Promise<DecisionInputs> {
    const a = c.applicant;
    const identity: ApplicantIdentity = {
      applicantId: a.id,
      fullName: a.fullName,
      birthDate: a.birthDate,
      governmentIdLast4: a.governmentIdLast4,
    };
    const [screening, bureau, fraud] = await Promise.all([
      this.kycAml.screen(identity).then(
        (s) => ({
          status: "OK" as const,
          sanctionsMatch: s.sanctionsMatch,
          kycVerified: s.kycVerified,
        }),
        (err: unknown) => unavailable(err),
      ),
      this.bureau.pull(identity).then(
        (b) => ({
          status: "OK" as const,
          fileDepth: b.fileDepth,
          bureauScore: b.bureauScore,
          tradeLines: b.tradeLines,
          utilisationPct: b.utilisationPct,
          delinquencies12m: b.delinquencies12m,
          existingDefault: b.existingDefault,
          monthsOnFile: b.monthsOnFile,
        }),
        (err: unknown) => unavailable(err),
      ),
      this.fraud.assess(identity).then(
        (f) => ({ status: "OK" as const, flagged: f.flagged, signals: [...f.signals] }),
        (err: unknown) => unavailable(err),
      ),
    ]);
    return {
      asOfDate,
      application: {
        productCode: c.productCode,
        amount: c.requestedAmount.toString(),
        tenorMonths: c.requestedTenorMonths,
      },
      applicant: {
        ageYears: ageOn(a.birthDate, asOfDate),
        monthlyIncome: a.monthlyIncome.toString(),
        monthlyObligations: a.monthlyObligations.toString(),
        employmentMonths: a.employmentMonths,
        relationshipMonths: a.relationshipMonths,
        declaredMonthlyIncome: a.declaredMonthlyIncome?.toString() ?? null,
        relatedParty: a.relatedParty,
      },
      screening,
      bureau,
      fraud,
    };
  }

  /** Whether a stored decision was made while the bureau, screening or fraud check could not answer. */
  static decidedDuringOutage(record: DecisionRecordEntity | null): boolean {
    if (!record) return false;
    return DecisionService.unavailableProvider(record.inputs) !== null;
  }

  /** The first provider that could not answer for these inputs, in words; null if all did. */
  static unavailableProvider(inputs: DecisionInputs): string | null {
    if (inputs.bureau.status === "UNAVAILABLE") return "The credit bureau";
    if (inputs.screening.status === "UNAVAILABLE") return "KYC/AML screening";
    if (inputs.fraud?.status === "UNAVAILABLE") return "The fraud check";
    return null;
  }

  /**
   * Whether a policy knockout failed in a stored decision. Live, a knockout declines; with
   * automation off, in shadow or under the kill switch it goes to a person, who may only
   * decline it (CasesService.recommend).
   */
  static knockedOut(record: DecisionRecordEntity | null): boolean {
    return record?.ruleResults.some((r) => r.kind === "KNOCKOUT" && r.result === "FAIL") ?? false;
  }

  /**
   * Decide and store the record in the caller's transaction. The product's automation is
   * read here, under a share lock in that same transaction, and added to the snapshot: a mode
   * change or the kill switch cannot slip in between reading it and recording the decision.
   */
  async decideAndRecord(
    manager: EntityManager,
    c: LoanCaseEntity,
    gathered: DecisionInputs,
    decidedBy: string,
  ): Promise<{ record: DecisionRecordEntity; result: DecisionResult }> {
    const versions = { ruleSet: CURRENT_RULE_SET, scorecard: CURRENT_SCORECARD };
    const automation = await this.automation.forDecision(manager, c.productCode);
    const inputs: DecisionInputs = { ...gathered, automation };
    const result = decide(inputs, versions);
    const record = await this.repo.insertDecision(manager, {
      caseId: c.id,
      inputs,
      inputsHash: hashInputs(inputs),
      ruleSetVersion: versions.ruleSet,
      scorecardVersion: versions.scorecard,
      outcome: result.outcome,
      score: result.score,
      grade: result.grade,
      ruleResults: result.ruleResults,
      scoreContributions: result.scoreContributions,
      reasonCodes: result.reasonCodes,
      referralTriggers: result.referralTriggers,
      debtToIncome: result.debtToIncome,
      monthlyRate: result.monthlyRate,
      // Both input providers share one mode (checked at boot); swapping them for real ones
      // changes no line here (Engineering Standard 9).
      providerMode: this.bureau.mode,
      automationMode: automation.mode,
      killSwitch: automation.killSwitch,
      engineOutcome: result.engineOutcome,
      decidedBy,
    });
    return { record, result };
  }

  /**
   * Replay a stored decision from its own inputs and versions (ADR 0022 R5). Read-only:
   * nothing is written, so compliance may call it.
   */
  reproduce(record: DecisionRecordEntity): ReproduceResult {
    const replay = decide(record.inputs, {
      ruleSet: record.ruleSetVersion,
      scorecard: record.scorecardVersion,
    });
    const stored: Record<string, unknown> = {
      outcome: record.outcome,
      score: record.score,
      grade: record.grade,
      ruleResults: record.ruleResults,
      scoreContributions: record.scoreContributions,
      reasonCodes: record.reasonCodes,
      referralTriggers: record.referralTriggers,
      debtToIncome: record.debtToIncome,
      monthlyRate: record.monthlyRate,
    };
    // A record from before automation modes has no engine outcome column: it ran live, so
    // its engine outcome is its outcome. Its mode columns hold the migration's LIVE backfill.
    stored.engineOutcome = record.engineOutcome ?? record.outcome;
    const replayed: Record<string, unknown> = {
      ...(replay as unknown as Record<string, unknown>),
      // The mode columns must agree with the snapshot the decision was made from.
      automationMode: record.inputs.automation?.mode ?? "LIVE",
      killSwitch: record.inputs.automation?.killSwitch ?? false,
    };
    stored.automationMode = record.automationMode;
    stored.killSwitch = record.killSwitch;
    const differences = Object.keys(stored).filter(
      (k) => canonicalJson(stored[k]) !== canonicalJson(replayed[k]),
    );
    return {
      decisionId: record.id,
      match: differences.length === 0,
      differences,
      inputsHashMatches: hashInputs(record.inputs) === record.inputsHash,
    };
  }
}

function unavailable(err: unknown): { status: "UNAVAILABLE"; reason: string } {
  if (isProviderUnavailable(err))
    return { status: "UNAVAILABLE", reason: `${err.failure.toLowerCase()}: ${err.message}` };
  throw err;
}

/** Whole years between a birth date and a date, both YYYY-MM-DD (no clock involved). */
export function ageOn(birthDate: string, asOf: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = asOf.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

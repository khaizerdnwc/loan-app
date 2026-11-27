import { CaseStatus, DRAFT_EXPIRY_DAYS, OFFER_EXPIRY_DAYS } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { TransactionRunner } from "../database/transaction-runner";
import { ActivityService } from "./activity.service";
import { CasesRepository } from "./cases.repository";
import { moveTo } from "./lifecycle";
import { expiresAt, expiryOf } from "./product";

/**
 * Closes stale cases as EXPIRED (PRD INT-003, the prototype's offer expiry): drafts unchanged
 * for DRAFT_EXPIRY_DAYS and offers unsigned for OFFER_EXPIRY_DAYS. The only thing the lending
 * module exports for the API's scheduler; the domain itself has no timer.
 */
@Injectable()
export class ExpiryService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Expire every stale draft and offer. Each case is expired in its own transaction, after
   * its row is locked and its status and age are checked again, so running this twice (or
   * alongside a signature or an edit) changes nothing more. Returns how many of each.
   */
  async expireStale(now: Date): Promise<{ drafts: number; offers: number }> {
    const stale = await this.repo.findStale(
      expiresAt(now, -DRAFT_EXPIRY_DAYS),
      expiresAt(now, -OFFER_EXPIRY_DAYS),
    );
    let drafts = 0;
    let offers = 0;
    for (const id of stale.drafts) if (await this.expireOne(id, CaseStatus.Draft, now)) drafts++;
    for (const id of stale.offers) if (await this.expireOne(id, CaseStatus.Offer, now)) offers++;
    return { drafts, offers };
  }

  private expireOne(id: string, expected: CaseStatus, now: Date): Promise<boolean> {
    return this.tx.run(async (m) => {
      const c = await this.repo.lockCase(m, id);
      if (!c || c.status !== expected) return false;
      const until = expiryOf(c);
      if (!until || until.getTime() > now.getTime()) return false;
      moveTo(c, "EXPIRE", CaseStatus.Expired);
      await this.repo.saveCase(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: "SYSTEM",
        systemName: "Expiry sweep",
        action: "EXPIRED",
        summary:
          expected === CaseStatus.Draft
            ? `Draft expired: unchanged for ${DRAFT_EXPIRY_DAYS} days.`
            : `Offer expired: not signed within ${OFFER_EXPIRY_DAYS} days.`,
        fromStatus: expected,
        toStatus: CaseStatus.Expired,
        details: { expiredAt: until.toISOString() },
      });
      return true;
    });
  }
}

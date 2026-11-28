import {
  type CaseDetail,
  type LoanOfficerView,
  Priority,
  type ReassignRequest,
  Role,
  type SetPriorityRequest,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import { TransactionRunner } from "../database/transaction-runner";
import { ActivityService } from "./activity.service";
import { canView } from "./case-access";
import { CasesRepository } from "./cases.repository";
import { CasesService } from "./cases.service";
import { forbiddenRole, invalidState, notFound, validation } from "./domain-error";
import type { LoanCaseEntity } from "./entities/loan-case.entity";
import { expiryRefusal } from "./product";
import { canPick, withOfficers } from "./routing";

/**
 * Queue routing for the loan officers (PRD WF-002): pick an unassigned referral from the team
 * queue, hand a case to another officer with a reason, and mark it high priority. Ownership
 * routes work; it does not restrict which loan officer may act on a case. Every change: lock
 * the case, check it again, change it, write the activity event — one transaction. No unique
 * index is involved, so concurrent picks are settled by the lock, not by a constraint.
 * Routing never moves `updated_at` (the draft-expiry clock and the queue's waiting time), and
 * an expired draft is refused like every other write on it.
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly staff: StaffRepository,
    private readonly activity: ActivityService,
    private readonly cases: CasesService,
  ) {}

  /** The loan officers a case can be handed to, with how many open cases each owns. */
  async loanOfficers(user: SessionUser): Promise<LoanOfficerView[]> {
    this.officerOnly(user);
    const officers = await this.staff.withRole(Role.LoanOfficer);
    const owned = await this.repo.openCasesByOwner();
    return officers.map((o) => ({
      id: o.id,
      fullName: o.fullName,
      openCases: owned.get(o.id) ?? 0,
    }));
  }

  async pick(user: SessionUser, id: string): Promise<CaseDetail> {
    this.officerOnly(user);
    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      if (!canPick(c)) {
        throw invalidState(
          c.ownerId
            ? "Another loan officer already owns this case. Ask them, or reassign it."
            : "Only a referred case waiting in the team queue can be picked.",
        );
      }
      c.ownerId = user.id;
      await this.repo.saveRouting(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "CASE_PICKED",
        summary: "Picked the case from the team queue.",
        details: { ownerId: user.id },
      });
    });
    return this.cases.get(user, id);
  }

  async reassign(user: SessionUser, id: string, body: ReassignRequest): Promise<CaseDetail> {
    this.officerOnly(user);
    const reason = body.reason?.trim() ?? "";
    if (!reason) {
      throw validation("Say why the case is handed over.", [
        { field: "reason", message: "Enter a reason for the reassignment." },
      ]);
    }
    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      if (!withOfficers(c.status)) {
        throw invalidState(
          "Only a case with the loan officers (draft or review) can be reassigned.",
        );
      }
      refuseIfExpired(c);
      const target = await this.staff.findById(body.ownerId, m);
      if (!target || target.role !== Role.LoanOfficer) {
        throw validation("Choose a loan officer.", [
          { field: "ownerId", message: "Choose a loan officer to hand the case to." },
        ]);
      }
      if (c.ownerId === target.id) {
        throw invalidState(`${target.fullName} already owns this case.`);
      }
      const from = c.ownerId;
      c.ownerId = target.id;
      await this.repo.saveRouting(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "CASE_REASSIGNED",
        summary: `Reassigned to ${target.fullName}: ${reason}`,
        details: { fromOwnerId: from, toOwnerId: target.id, reason },
      });
    });
    return this.cases.get(user, id);
  }

  async setPriority(user: SessionUser, id: string, body: SetPriorityRequest): Promise<CaseDetail> {
    this.officerOnly(user);
    await this.tx.run(async (m) => {
      const c = await this.lock(m, user, id);
      if (!withOfficers(c.status)) {
        throw invalidState("Priority orders the loan officers' queue; this case is not in it.");
      }
      refuseIfExpired(c);
      if (c.priority === body.priority) {
        throw invalidState(
          `This case is already ${body.priority === Priority.High ? "high" : "normal"} priority.`,
        );
      }
      const from = c.priority;
      c.priority = body.priority;
      await this.repo.saveRouting(m, c);
      await this.activity.record(m, {
        caseId: c.id,
        actor: user,
        action: "PRIORITY_CHANGED",
        summary:
          body.priority === Priority.High
            ? "Marked high priority."
            : "Set back to normal priority.",
        details: { from, to: body.priority },
      });
    });
    return this.cases.get(user, id);
  }

  private officerOnly(user: SessionUser): void {
    if (user.role !== Role.LoanOfficer) {
      throw forbiddenRole("Only a loan officer routes the loan officers' queue.");
    }
  }

  private async lock(m: EntityManager, user: SessionUser, id: string): Promise<LoanCaseEntity> {
    const c = await this.repo.lockCase(m, id);
    if (!c || !canView(user, c)) throw notFound();
    return c;
  }
}

/** The same 409 as every other write on a draft or offer that has expired (not yet swept). */
function refuseIfExpired(c: LoanCaseEntity): void {
  const refusal = expiryRefusal(c, new Date());
  if (refusal) throw invalidState(refusal);
}

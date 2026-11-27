import {
  AUTOMATION_MODE_LABEL,
  type AutomationActionAvailability,
  type AutomationChangeRequest,
  type AutomationChangeView,
  type AutomationEventView,
  AutomationMode,
  type AutomationView,
  ProblemCode,
  productLabel,
  Role,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import {
  DomainError,
  invalidState,
  makerChecker,
  notFound,
  validation,
} from "../cases/domain-error";
import { TransactionRunner } from "../database/transaction-runner";
import type { AutomationChangeEntity, ProductAutomationEntity } from "./automation.entities";
import { AutomationRepository } from "./automation.repository";

/** What a decision runs under: the product's mode and kill switch. */
export interface AutomationSnapshot {
  mode: AutomationMode;
  killSwitch: boolean;
}

/**
 * Per-product automation and the kill switch (PRD §7.5, AIS-007, F8).
 *
 * - A mode change (off, shadow, live) is drafted by one administrator and takes effect only
 *   when a different administrator approves it (maker-checker, PRD §4: a credit risk change
 *   is approved by a second user).
 * - The kill switch turns on at once, by one administrator: it only sends cases to a person,
 *   and the PRD asks for it to act "instantly". Turning it off resumes automated decisions,
 *   so that is a change for a second administrator to approve.
 * - Every change locks the product's row and writes its history event in one transaction.
 *   The row lock also serialises drafts, so the "one pending change per product" check
 *   cannot race (the partial unique index is a backstop, not the gate).
 */
@Injectable()
export class AutomationService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: AutomationRepository,
    private readonly staff: StaffRepository,
  ) {}

  // --- read by the decision ------------------------------------------------------------------

  /**
   * The product's automation for a decision, read in the decision's transaction under a share
   * lock (AutomationRepository.readForDecision). A product with no row runs OFF: nothing is
   * decided automatically for a product nobody switched on.
   */
  async forDecision(m: EntityManager, productCode: string): Promise<AutomationSnapshot> {
    const row = await this.repo.readForDecision(m, productCode);
    if (!row) return { mode: AutomationMode.Off, killSwitch: false };
    return { mode: row.mode, killSwitch: row.killSwitch };
  }

  // --- reads ---------------------------------------------------------------------------------

  async list(user: SessionUser): Promise<AutomationView[]> {
    const [rows, pending] = await Promise.all([this.repo.list(), this.repo.pendingChanges()]);
    const names = await this.staff.namesById(
      [
        ...rows.map((r) => r.killSwitchSetBy),
        ...pending.flatMap((c) => [c.requestedBy, c.decidedBy]),
      ].filter((id): id is string => id !== null),
    );
    return rows.map((row) => {
      const change = pending.find((c) => c.productCode === row.productCode) ?? null;
      return {
        productCode: row.productCode,
        productName: productLabel(row.productCode),
        mode: row.mode,
        killSwitch: row.killSwitch,
        killSwitchSetByName: row.killSwitchSetBy
          ? (names.get(row.killSwitchSetBy) ?? row.killSwitchSetBy)
          : null,
        killSwitchSetAt: row.killSwitchSetAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        pendingChange: change ? changeView(change, names) : null,
        allowedActions: allowedActions(user, row, change),
      };
    });
  }

  async history(productCode: string): Promise<AutomationEventView[]> {
    if (!(await this.repo.find(productCode))) throw notFound("product");
    return (await this.repo.events(productCode)).map((e) => ({
      id: e.id,
      productCode: e.productCode,
      action: e.action,
      summary: e.summary,
      actorName: e.actorName,
      details: e.details,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // --- changes -------------------------------------------------------------------------------

  /** Draft a mode change, or turning the kill switch off, for another administrator. */
  async requestChange(
    user: SessionUser,
    productCode: string,
    body: AutomationChangeRequest,
  ): Promise<AutomationView[]> {
    const reason = body.reason?.trim();
    if (!reason) {
      throw validation("Give a reason for the change.", [
        { field: "reason", message: "Enter a reason." },
      ]);
    }
    if (body.kind === "KILL_SWITCH_OFF" && "mode" in body && body.mode !== undefined) {
      throw validation("Turning the kill switch off does not change the mode.", [
        { field: "mode", message: "Leave the mode out, or request a mode change instead." },
      ]);
    }
    await this.tx.run(async (m) => {
      const row = await this.lockProduct(m, productCode);
      const pending = await this.repo.findPending(m, productCode);
      if (pending) throw changePending(row, pending, await this.nameOf(m, pending.requestedBy));

      if (body.kind === "SET_MODE" && body.mode === row.mode) {
        throw validation(`${productLabel(productCode)} is already ${modeWords(row.mode)}.`, [
          { field: "mode", message: "Choose a different mode." },
        ]);
      }
      if (body.kind === "KILL_SWITCH_OFF" && !row.killSwitch) {
        throw invalidState("The kill switch is already off.");
      }

      const change = this.repo.newChange(m);
      change.productCode = productCode;
      change.kind = body.kind;
      change.requestedMode = body.kind === "SET_MODE" ? body.mode : null;
      change.fromMode = row.mode;
      change.reason = reason;
      change.status = "PENDING";
      change.requestedBy = user.id;
      change.decidedBy = null;
      change.decidedAt = null;
      change.decisionNote = null;
      const saved = await this.repo.saveChange(m, change);
      await this.repo.insertEvent(m, {
        productCode,
        changeId: saved.id,
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: body.kind === "SET_MODE" ? "MODE_CHANGE_REQUESTED" : "KILL_SWITCH_OFF_REQUESTED",
        summary:
          body.kind === "SET_MODE"
            ? `Asked to change ${productLabel(productCode)} from ${modeWords(row.mode)} to ${modeWords(body.mode)}; waiting for a second administrator.`
            : `Asked to turn the ${productLabel(productCode)} kill switch off; waiting for a second administrator.`,
        details: {
          before: { mode: row.mode, killSwitch: row.killSwitch },
          requested:
            body.kind === "SET_MODE"
              ? { mode: body.mode, killSwitch: row.killSwitch }
              : { mode: row.mode, killSwitch: false },
          reason,
        },
      });
    });
    return this.list(user);
  }

  /** Approve another administrator's change: it takes effect in this transaction. */
  async approve(
    user: SessionUser,
    productCode: string,
    changeId: string,
    note?: string,
  ): Promise<AutomationView[]> {
    await this.tx.run(async (m) => {
      const row = await this.lockProduct(m, productCode);
      const change = await this.lockPendingChange(m, productCode, changeId);
      if (change.requestedBy === user.id) {
        throw makerChecker("You drafted this change; a different administrator must approve it.");
      }
      const before = { mode: row.mode, killSwitch: row.killSwitch };
      if (change.kind === "SET_MODE") {
        if (row.mode !== change.fromMode || !change.requestedMode) {
          throw invalidState(
            "The mode changed after this request was drafted. Reject it and draft a new one.",
          );
        }
        row.mode = change.requestedMode;
      } else {
        if (!row.killSwitch) throw invalidState("The kill switch is already off.");
        row.killSwitch = false;
        row.killSwitchSetBy = null;
        row.killSwitchSetAt = null;
      }
      row.updatedAt = new Date();
      await this.repo.save(m, row);
      this.close(change, "APPROVED", user, note);
      await this.repo.saveChange(m, change);
      const requester = await this.nameOf(m, change.requestedBy);
      await this.repo.insertEvent(m, {
        productCode,
        changeId: change.id,
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: change.kind === "SET_MODE" ? "MODE_CHANGED" : "KILL_SWITCH_OFF",
        summary:
          change.kind === "SET_MODE"
            ? `Approved ${requester}'s change: ${productLabel(productCode)} automation is now ${modeWords(row.mode)} (was ${modeWords(before.mode)}).`
            : `Approved ${requester}'s request: the ${productLabel(productCode)} kill switch is off; automated decisions follow the mode (${modeWords(row.mode)}).`,
        details: {
          before,
          after: { mode: row.mode, killSwitch: row.killSwitch },
          requestedBy: change.requestedBy,
          reason: change.reason,
          note: change.decisionNote,
        },
      });
    });
    return this.list(user);
  }

  /** Reject a change (or withdraw your own): nothing about the product changes. */
  async reject(
    user: SessionUser,
    productCode: string,
    changeId: string,
    note?: string,
  ): Promise<AutomationView[]> {
    await this.tx.run(async (m) => {
      const row = await this.lockProduct(m, productCode);
      const change = await this.lockPendingChange(m, productCode, changeId);
      const own = change.requestedBy === user.id;
      this.close(change, own ? "WITHDRAWN" : "REJECTED", user, note);
      await this.repo.saveChange(m, change);
      const requester = await this.nameOf(m, change.requestedBy);
      const state = { mode: row.mode, killSwitch: row.killSwitch };
      await this.repo.insertEvent(m, {
        productCode,
        changeId: change.id,
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: own ? "CHANGE_WITHDRAWN" : "CHANGE_REJECTED",
        summary: own
          ? `Withdrew the request (${describeChange(change)}).`
          : `Rejected ${requester}'s request (${describeChange(change)}); ${productLabel(productCode)} stays ${modeWords(row.mode)}${row.killSwitch ? " with the kill switch on" : ""}.`,
        details: {
          before: state,
          after: state,
          requestedBy: change.requestedBy,
          reason: change.reason,
          note: change.decisionNote,
        },
      });
    });
    return this.list(user);
  }

  /** Turn the kill switch on, at once: every new application for the product goes to a person. */
  async killSwitchOn(
    user: SessionUser,
    productCode: string,
    reasonRaw: string,
  ): Promise<AutomationView[]> {
    const reason = reasonRaw?.trim();
    if (!reason) {
      throw validation("Give a reason for turning the kill switch on.", [
        { field: "reason", message: "Enter a reason." },
      ]);
    }
    await this.tx.run(async (m) => {
      const row = await this.lockProduct(m, productCode);
      if (row.killSwitch) throw invalidState("The kill switch is already on.");
      row.killSwitch = true;
      row.killSwitchSetBy = user.id;
      row.killSwitchSetAt = new Date();
      row.updatedAt = row.killSwitchSetAt;
      await this.repo.save(m, row);
      await this.repo.insertEvent(m, {
        productCode,
        changeId: null,
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: "KILL_SWITCH_ON",
        summary: `Turned the ${productLabel(productCode)} kill switch on: every new application goes to manual review.`,
        details: {
          before: { mode: row.mode, killSwitch: false },
          after: { mode: row.mode, killSwitch: true },
          reason,
        },
      });
    });
    return this.list(user);
  }

  // --- helpers -------------------------------------------------------------------------------

  private async lockProduct(m: EntityManager, productCode: string) {
    const row = await this.repo.lockForChange(m, productCode);
    if (!row) throw notFound("product");
    return row;
  }

  private async lockPendingChange(
    m: EntityManager,
    productCode: string,
    changeId: string,
  ): Promise<AutomationChangeEntity> {
    const change = await this.repo.lockChange(m, changeId);
    if (!change || change.productCode !== productCode) throw notFound("change request");
    if (change.status !== "PENDING") {
      throw invalidState(`This request was already ${change.status.toLowerCase()}.`);
    }
    return change;
  }

  private close(
    change: AutomationChangeEntity,
    status: "APPROVED" | "REJECTED" | "WITHDRAWN",
    user: SessionUser,
    note: string | undefined,
  ): void {
    change.status = status;
    change.decidedBy = user.id;
    change.decidedAt = new Date();
    change.decisionNote = note?.trim() || null;
  }

  /** A staff member's name, read on the transaction's own connection. */
  private async nameOf(m: EntityManager, id: string): Promise<string> {
    return (await this.staff.findById(id, m))?.fullName ?? id;
  }
}

function modeWords(mode: AutomationMode): string {
  return AUTOMATION_MODE_LABEL[mode].toLowerCase();
}

function describeChange(change: AutomationChangeEntity): string {
  return change.kind === "SET_MODE" && change.requestedMode
    ? `${modeWords(change.fromMode)} to ${modeWords(change.requestedMode)}`
    : "turn the kill switch off";
}

function changePending(
  row: ProductAutomationEntity,
  pending: AutomationChangeEntity,
  requester: string,
): DomainError {
  return new DomainError(
    409,
    ProblemCode.Conflict,
    `A change to ${productLabel(row.productCode)} (${describeChange(pending)}) drafted by ${requester} is waiting for approval. Approve or reject it first.`,
  );
}

function changeView(c: AutomationChangeEntity, names: Map<string, string>): AutomationChangeView {
  return {
    id: c.id,
    productCode: c.productCode,
    kind: c.kind,
    requestedMode: c.requestedMode,
    fromMode: c.fromMode,
    reason: c.reason,
    status: c.status,
    requestedBy: c.requestedBy,
    requestedByName: names.get(c.requestedBy) ?? c.requestedBy,
    requestedAt: c.requestedAt.toISOString(),
    decidedBy: c.decidedBy,
    decidedByName: c.decidedBy ? (names.get(c.decidedBy) ?? c.decidedBy) : null,
    decidedAt: c.decidedAt?.toISOString() ?? null,
  };
}

const WAITING = "A change is waiting for approval: approve or reject it first.";
const OWN_CHANGE = "You drafted this change; a different administrator must approve it.";

/** The actions an administrator may take now; the service refuses the rest with the same reasons. */
function allowedActions(
  user: SessionUser,
  row: ProductAutomationEntity,
  pending: AutomationChangeEntity | null,
): AutomationActionAvailability[] {
  if (user.role !== Role.Admin) return [];
  const blocked = (
    action: AutomationActionAvailability["action"],
    code: ProblemCode,
    detail: string,
  ) => ({ action, enabled: false, blockedBy: code, detail }) as const;
  const actions: AutomationActionAvailability[] = [
    pending
      ? blocked("REQUEST_MODE_CHANGE", ProblemCode.Conflict, WAITING)
      : { action: "REQUEST_MODE_CHANGE", enabled: true },
  ];
  if (!row.killSwitch) {
    actions.push({ action: "KILL_SWITCH_ON", enabled: true });
  } else {
    actions.push(
      pending
        ? blocked("REQUEST_KILL_SWITCH_OFF", ProblemCode.Conflict, WAITING)
        : { action: "REQUEST_KILL_SWITCH_OFF", enabled: true },
    );
  }
  if (pending) {
    // The drafter may not approve, and closing their own request is a withdrawal.
    actions.push(
      ...(pending.requestedBy === user.id
        ? [
            blocked("APPROVE_CHANGE", ProblemCode.MakerChecker, OWN_CHANGE),
            { action: "WITHDRAW_CHANGE", enabled: true } as const,
          ]
        : [
            { action: "APPROVE_CHANGE", enabled: true } as const,
            { action: "REJECT_CHANGE", enabled: true } as const,
          ]),
    );
  }
  return actions;
}

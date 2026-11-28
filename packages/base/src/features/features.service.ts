import {
  FEATURE_FLAG_LABEL,
  FEATURE_FLAGS,
  type FeatureFlag,
  type FeatureFlagChangeRequest,
  type FeatureFlagView,
  type FeatureStateView,
  ProblemCode,
  Role,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import {
  DomainError,
  forbiddenRole,
  invalidState,
  makerChecker,
  notFound,
  validation,
} from "../cases/domain-error";
import { TransactionRunner } from "../database/transaction-runner";
import type { FeatureFlagChangeEntity, FeatureFlagEntity } from "./features.entities";
import { FeaturesRepository } from "./features.repository";

/**
 * Feature flags (PRD PLT-006: switch modules on or off for the bank).
 *
 * - The modules that consult a flag call `assertEnabled` at their service entry points, so a
 *   switched-off module refuses every request (404, FEATURE_DISABLED) whatever the screen
 *   shows; the backoffice only mirrors `state()` by hiding the module.
 * - A change is drafted by one administrator and applied when a different administrator
 *   approves it (maker-checker, as for the automation mode). Either administrator, or the
 *   drafter withdrawing it, can reject it.
 * - Every step locks the flag's row and writes its audit entry in the same transaction, on the
 *   transaction's own connection; the audit log is the flags' history (they belong to no case,
 *   so there is no case activity). The row lock also serialises drafts, so "one pending change
 *   per flag" cannot race (the partial unique index is a backstop, not the gate).
 */
@Injectable()
export class FeaturesService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: FeaturesRepository,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
  ) {}

  // --- read by the modules -------------------------------------------------------------------

  /** Whether a module is on. A flag with no row is off: nothing runs that nobody switched on. */
  async isEnabled(flag: FeatureFlag): Promise<boolean> {
    return (await this.repo.find(flag))?.enabled ?? false;
  }

  /** Refuse the request when the module is switched off for the bank. */
  async assertEnabled(flag: FeatureFlag): Promise<void> {
    if (!(await this.isEnabled(flag))) {
      throw new DomainError(
        404,
        ProblemCode.FeatureDisabled,
        `${FEATURE_FLAG_LABEL[flag]} is switched off for this bank.`,
      );
    }
  }

  /** Every module's state, for any signed-in user (the backoffice hides what is off). */
  async state(): Promise<FeatureStateView> {
    const rows = new Map((await this.repo.list()).map((r) => [r.key, r.enabled]));
    return Object.fromEntries(
      FEATURE_FLAGS.map((f) => [f, rows.get(f) ?? false]),
    ) as FeatureStateView;
  }

  // --- administrators ------------------------------------------------------------------------

  async list(user: SessionUser): Promise<FeatureFlagView[]> {
    adminOnly(user);
    const [rows, pending] = await Promise.all([this.repo.list(), this.repo.pendingChanges()]);
    const names = await this.staff.namesById(
      [...rows.map((r) => r.updatedBy), ...pending.map((c) => c.requestedBy)].filter(
        (id): id is string => id !== null,
      ),
    );
    return rows.map((row) => {
      const change = pending.find((c) => c.flagKey === row.key) ?? null;
      const ownChange = change?.requestedBy === user.id;
      const admin = user.role === Role.Admin;
      return {
        key: row.key,
        label: FEATURE_FLAG_LABEL[row.key] ?? row.key,
        enabled: row.enabled,
        updatedAt: row.updatedAt.toISOString(),
        updatedByName: row.updatedBy ? (names.get(row.updatedBy) ?? row.updatedBy) : null,
        pendingChange: change
          ? {
              id: change.id,
              enabled: change.requestedEnabled,
              reason: change.reason,
              requestedByName: names.get(change.requestedBy) ?? change.requestedBy,
              requestedAt: change.requestedAt.toISOString(),
            }
          : null,
        allowedActions: {
          request: admin && !change,
          approve: admin && !!change && !ownChange,
          reject: admin && !!change,
          approveBlockedReason:
            change && ownChange
              ? "You drafted this change; a different administrator must approve it."
              : null,
        },
      };
    });
  }

  /** Draft switching a module on or off, for a second administrator to approve. */
  async requestChange(
    user: SessionUser,
    key: string,
    body: FeatureFlagChangeRequest,
  ): Promise<FeatureFlagView[]> {
    adminOnly(user);
    const flag = knownFlag(key);
    const reason = body.reason?.trim();
    if (!reason) {
      throw validation("Give a reason for the change.", [
        { field: "reason", message: "Enter a reason." },
      ]);
    }
    await this.tx.run(async (m) => {
      const row = await this.lock(m, flag);
      if (await this.repo.findPending(m, flag)) {
        throw invalidState(
          `A change to ${FEATURE_FLAG_LABEL[flag]} is already waiting for approval. Approve or reject it first.`,
        );
      }
      if (body.enabled === row.enabled) {
        throw validation(`${FEATURE_FLAG_LABEL[flag]} is already ${onOff(row.enabled)}.`, [
          { field: "enabled", message: "Choose the other state." },
        ]);
      }
      const change = this.repo.newChange(m);
      change.flagKey = flag;
      change.requestedEnabled = body.enabled;
      change.reason = reason;
      change.status = "PENDING";
      change.requestedBy = user.id;
      change.decidedBy = null;
      change.decidedAt = null;
      change.decisionNote = null;
      const saved = await this.repo.saveChange(m, change);
      await this.audit.append(m, {
        actor: user,
        action: "FEATURE_FLAG_CHANGE_REQUESTED",
        summary: `Asked to switch ${FEATURE_FLAG_LABEL[flag]} ${onOff(body.enabled)}; waiting for a second administrator.`,
        details: {
          flag,
          changeId: saved.id,
          before: { enabled: row.enabled },
          requested: { enabled: body.enabled },
          reason,
        },
      });
    });
    return this.list(user);
  }

  /** Approve another administrator's change: the module switches in this transaction. */
  async approve(
    user: SessionUser,
    key: string,
    changeId: string,
    note?: string,
  ): Promise<FeatureFlagView[]> {
    adminOnly(user);
    const flag = knownFlag(key);
    await this.tx.run(async (m) => {
      const row = await this.lock(m, flag);
      const change = await this.lockPending(m, flag, changeId);
      if (change.requestedBy === user.id) {
        throw makerChecker("You drafted this change; a different administrator must approve it.");
      }
      const before = row.enabled;
      row.enabled = change.requestedEnabled;
      row.updatedBy = user.id;
      row.updatedAt = new Date();
      await this.repo.saveFlag(m, row);
      decide(change, "APPROVED", user, note);
      await this.repo.saveChange(m, change);
      await this.audit.append(m, {
        actor: user,
        action: "FEATURE_FLAG_CHANGED",
        summary: `Switched ${FEATURE_FLAG_LABEL[flag]} ${onOff(row.enabled)}, approving another administrator's request.`,
        details: {
          flag,
          changeId: change.id,
          before: { enabled: before },
          after: { enabled: row.enabled },
          requestedBy: change.requestedBy,
          reason: change.reason,
          note: change.decisionNote,
        },
      });
    });
    return this.list(user);
  }

  /** Reject a change (or withdraw your own); the flag stays as it is. */
  async reject(
    user: SessionUser,
    key: string,
    changeId: string,
    note?: string,
  ): Promise<FeatureFlagView[]> {
    adminOnly(user);
    const flag = knownFlag(key);
    await this.tx.run(async (m) => {
      const row = await this.lock(m, flag);
      const change = await this.lockPending(m, flag, changeId);
      const withdrawn = change.requestedBy === user.id;
      decide(change, "REJECTED", user, note);
      await this.repo.saveChange(m, change);
      await this.audit.append(m, {
        actor: user,
        action: withdrawn ? "FEATURE_FLAG_CHANGE_WITHDRAWN" : "FEATURE_FLAG_CHANGE_REJECTED",
        summary: withdrawn
          ? `Withdrew the request to switch ${FEATURE_FLAG_LABEL[flag]} ${onOff(change.requestedEnabled)}.`
          : `Rejected the request to switch ${FEATURE_FLAG_LABEL[flag]} ${onOff(change.requestedEnabled)}; it stays ${onOff(row.enabled)}.`,
        details: {
          flag,
          changeId: change.id,
          before: { enabled: row.enabled },
          after: { enabled: row.enabled },
          requested: { enabled: change.requestedEnabled },
          note: change.decisionNote,
        },
      });
    });
    return this.list(user);
  }

  // --- helpers -------------------------------------------------------------------------------

  private async lock(m: EntityManager, flag: FeatureFlag): Promise<FeatureFlagEntity> {
    const row = await this.repo.lockFlag(m, flag);
    if (!row) throw notFound("feature flag");
    return row;
  }

  private async lockPending(
    m: EntityManager,
    flag: FeatureFlag,
    changeId: string,
  ): Promise<FeatureFlagChangeEntity> {
    const change = await this.repo.lockChange(m, changeId);
    if (!change || change.flagKey !== flag) throw notFound("change request");
    if (change.status !== "PENDING") {
      throw invalidState(`This change was already ${change.status.toLowerCase()}.`);
    }
    return change;
  }
}

function decide(
  change: FeatureFlagChangeEntity,
  status: "APPROVED" | "REJECTED",
  user: SessionUser,
  note?: string,
): void {
  change.status = status;
  change.decidedBy = user.id;
  change.decidedAt = new Date();
  change.decisionNote = note?.trim() || null;
}

/** Flags are the administrators' (the controller's @Roles is the first gate; this the second). */
function adminOnly(user: SessionUser): void {
  if (user.role !== Role.Admin)
    throw forbiddenRole("Only an administrator can manage feature flags.");
}

function knownFlag(key: string): FeatureFlag {
  if (!(FEATURE_FLAGS as readonly string[]).includes(key)) throw notFound("feature flag");
  return key as FeatureFlag;
}

const onOff = (enabled: boolean) => (enabled ? "on" : "off");

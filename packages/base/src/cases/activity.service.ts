import type { CaseStatus } from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { NotificationService } from "../notifications/notification.service";
import { ActivityEventEntity } from "./entities/activity-event.entity";

export interface ActivityInput {
  caseId: string;
  actor: SessionUser | "SYSTEM";
  action: string;
  summary: string;
  fromStatus?: CaseStatus | null;
  toStatus?: CaseStatus | null;
  details?: Record<string, unknown>;
  /** The name shown for a SYSTEM actor (default: the decision engine). */
  systemName?: string;
  /**
   * Written to the audit log only, never to the case history that case workers read: e.g.
   * Compliance's notes, outcome and the matched list on an AML review (no tipping-off).
   */
  auditOnly?: { summary?: string; details?: Record<string, unknown> };
}

/**
 * Writes the case history. Always called with the manager of the transaction that makes
 * the change, so the change and its history commit together (AGENTS.md non-negotiable 5),
 * and mirrors each event into the audit log in that same transaction.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async record(manager: EntityManager, input: ActivityInput): Promise<void> {
    const system = input.actor === "SYSTEM";
    const actor = input.actor as SessionUser;
    const repo = manager.getRepository(ActivityEventEntity);
    const event = repo.create();
    event.caseId = input.caseId;
    event.actorId = system ? "SYSTEM" : actor.id;
    event.actorName = system ? (input.systemName ?? "Decision engine") : actor.fullName;
    event.actorRole = system ? "SYSTEM" : actor.role;
    event.action = input.action;
    event.summary = input.summary;
    event.fromStatus = input.fromStatus ?? null;
    event.toStatus = input.toStatus ?? null;
    event.details = input.details ?? {};
    await repo.save(event);
    // Every case event is also an entry in the hash-chained audit log, in this transaction.
    await this.audit.append(manager, {
      actor: system
        ? { id: "SYSTEM", fullName: input.systemName ?? "Decision engine", role: "SYSTEM" }
        : actor,
      action: input.action,
      summary: input.auditOnly?.summary ?? input.summary,
      caseId: input.caseId,
      details: {
        ...(input.details ?? {}),
        ...(input.auditOnly?.details ?? {}),
        ...(input.fromStatus || input.toStatus
          ? { fromStatus: input.fromStatus ?? null, toStatus: input.toStatus ?? null }
          : {}),
      },
    });
    // Staff alerts and borrower messages the event calls for (PRD NTF-001/002), in this
    // transaction too; the gateway is called later, outside it.
    await this.notifications.onActivity(manager, {
      caseId: input.caseId,
      actorId: system ? "SYSTEM" : actor.id,
      action: input.action,
      toStatus: input.toStatus ?? null,
      details: input.details ?? {},
    });
  }
}

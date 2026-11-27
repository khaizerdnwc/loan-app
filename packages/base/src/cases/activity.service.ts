import type { CaseStatus } from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { ActivityEventEntity } from "./entities/activity-event.entity";

export interface ActivityInput {
  caseId: string;
  actor: SessionUser | "SYSTEM";
  action: string;
  summary: string;
  fromStatus?: CaseStatus | null;
  toStatus?: CaseStatus | null;
  details?: Record<string, unknown>;
}

/**
 * Writes the case history. Always called with the manager of the transaction that makes
 * the change, so the change and its history commit together (AGENTS.md non-negotiable 5).
 */
@Injectable()
export class ActivityService {
  async record(manager: EntityManager, input: ActivityInput): Promise<void> {
    const system = input.actor === "SYSTEM";
    const actor = input.actor as SessionUser;
    const repo = manager.getRepository(ActivityEventEntity);
    const event = repo.create();
    event.caseId = input.caseId;
    event.actorId = system ? "SYSTEM" : actor.id;
    event.actorName = system ? "Decision engine" : actor.fullName;
    event.actorRole = system ? "SYSTEM" : actor.role;
    event.action = input.action;
    event.summary = input.summary;
    event.fromStatus = input.fromStatus ?? null;
    event.toStatus = input.toStatus ?? null;
    event.details = input.details ?? {};
    await repo.save(event);
  }
}

import type { AuditChainVerification, AuditEventView, AuditLogPage } from "@loan/core";
import { Role } from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { SessionUser } from "../auth/session";
import { TransactionRunner } from "../database/transaction-runner";
import { type AuditFilter, AuditRepository } from "./audit.repository";
import { type ChainCheck, chainHash, checkLinks, GENESIS_HASH, plainDetails } from "./audit-chain";
import { AuditEventEntity } from "./entities/audit-event.entity";

/** Who an entry is about: a signed-in user, the decision engine, or a sign-in with no account. */
export type AuditActor = SessionUser | "SYSTEM" | { id: string; fullName: string; role: string };

export interface AuditInput {
  actor: AuditActor;
  action: string;
  summary: string;
  caseId?: string | null;
  details?: Record<string, unknown>;
}

const VERIFY_BATCH = 1_000;

/**
 * The tamper-evident audit log (PRD PLT-004, CMP-010). `append` is always called with the
 * manager of the transaction that makes the change, so the change and its entry commit
 * together (one connection: the reference lookup, the chain lock and the insert all use it);
 * it takes the chain lock, reads the head and links the new entry to it.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly tx: TransactionRunner,
  ) {}

  async append(m: EntityManager, input: AuditInput): Promise<void> {
    const actor =
      input.actor === "SYSTEM"
        ? { id: "SYSTEM", fullName: "Decision engine", role: "SYSTEM" }
        : input.actor;
    const caseId = input.caseId ?? null;
    const caseReference = caseId ? await this.repo.caseReference(m, caseId) : null;
    const head = await this.repo.lockHead(m);
    const fields = {
      seq: head ? head.seq + 1 : 1,
      // Taken under the lock, so time follows the chain's order.
      occurredAt: new Date().toISOString(),
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: input.action,
      caseId,
      caseReference,
      summary: input.summary,
      details: plainDetails(input.details),
    };
    const prevHash = head?.hash ?? GENESIS_HASH;
    const entry = new AuditEventEntity();
    Object.assign(entry, {
      ...fields,
      seq: String(fields.seq),
      occurredAt: new Date(fields.occurredAt),
      prevHash,
      hash: chainHash(prevHash, fields),
    });
    await this.repo.insert(m, entry);
  }

  /** Append in a transaction of its own (sign-ins, simulation switches). */
  async record(input: AuditInput): Promise<void> {
    await this.tx.run((m) => this.append(m, input));
  }

  async search(user: SessionUser, filter: AuditFilter): Promise<AuditLogPage> {
    const rows = await this.repo.search({ ...filter, limit: filter.limit + 1 });
    const page = rows.slice(0, filter.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((e) => view(e, user)),
      nextBefore: rows.length > filter.limit && last ? Number(last.seq) : null,
    };
  }

  actions(): Promise<string[]> {
    return this.repo.actions();
  }

  /** Recompute every hash and link from the first entry (read-only). */
  async verify(): Promise<AuditChainVerification> {
    let state: ChainCheck = { checked: 0, firstBrokenSeq: null, problem: null, last: null };
    for (;;) {
      const batch = await this.repo.batch(state.last?.seq ?? 0, VERIFY_BATCH);
      if (batch.length === 0) break;
      state = checkLinks(
        batch.map((e) => ({
          seq: Number(e.seq),
          occurredAt: e.occurredAt.toISOString(),
          actorId: e.actorId,
          actorName: e.actorName,
          actorRole: e.actorRole,
          action: e.action,
          caseId: e.caseId,
          caseReference: e.caseReference,
          summary: e.summary,
          details: e.details,
          prevHash: e.prevHash,
          hash: e.hash,
        })),
        state.last,
        state.checked,
      );
      if (state.problem || batch.length < VERIFY_BATCH) break;
    }
    return {
      intact: state.problem === null,
      checked: state.checked,
      firstBrokenSeq: state.firstBrokenSeq,
      problem: state.problem,
      headSeq: state.last?.seq ?? null,
      headHash: state.last?.hash ?? null,
      verifiedAt: new Date().toISOString(),
    };
  }
}

/**
 * An entry as the caller may see it. An administrator cannot open cases (docs/API.md), so
 * for an entry about a case they see who did what and when, but not which case, nor its
 * summary or details (so the log cannot tell them which cases carry AML reviews).
 */
function view(e: AuditEventEntity, user: SessionUser): AuditEventView {
  const hidden = user.role === Role.Admin && e.caseId !== null;
  return {
    seq: Number(e.seq),
    occurredAt: e.occurredAt.toISOString(),
    actorId: e.actorId,
    actorName: e.actorName,
    actorRole: e.actorRole,
    action: e.action,
    caseId: hidden ? null : e.caseId,
    caseReference: hidden ? null : e.caseReference,
    caseHidden: hidden,
    summary: hidden ? null : e.summary,
    details: hidden ? null : e.details,
    hash: e.hash,
  };
}

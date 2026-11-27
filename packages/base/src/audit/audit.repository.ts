import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import { AuditEventEntity } from "./entities/audit-event.entity";

/** The one lock every audit append takes, so the chain has one head at a time. */
const CHAIN_LOCK_KEY = "audit_event_chain";

export interface AuditFilter {
  /** A staff id (exact) or part of a name. */
  actor?: string;
  action?: string;
  /** Inclusive bounds. */
  from?: Date;
  to?: Date;
  caseReference?: string;
  /** Entries older than this seq (paging). */
  before?: number;
  limit: number;
}

/** Storage for the audit chain. Raw queries stay here (house/no-datasource-outside-repository). */
@Injectable()
export class AuditRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * Take the chain lock for the rest of the caller's transaction, then read the head. Two
   * transactions appending at once queue here, so each links to the other's committed entry.
   */
  async lockHead(m: EntityManager): Promise<{ seq: number; hash: string } | null> {
    await m.query("SELECT pg_advisory_xact_lock(hashtext($1))", [CHAIN_LOCK_KEY]);
    const head = await m
      .getRepository(AuditEventEntity)
      .find({ select: { seq: true, hash: true }, order: { seq: "DESC" }, take: 1 });
    const row = head[0];
    return row ? { seq: Number(row.seq), hash: row.hash } : null;
  }

  async insert(m: EntityManager, entry: AuditEventEntity): Promise<void> {
    // A plain INSERT (no read-before-write): the row is never updated.
    await m
      .getRepository(AuditEventEntity)
      .insert(entry as QueryDeepPartialEntity<AuditEventEntity>);
  }

  async caseReference(m: EntityManager, caseId: string): Promise<string | null> {
    const c = await m
      .getRepository(LoanCaseEntity)
      .findOne({ select: { id: true, reference: true }, where: { id: caseId } });
    return c?.reference ?? null;
  }

  async search(filter: AuditFilter): Promise<AuditEventEntity[]> {
    const q = this.ds.getRepository(AuditEventEntity).createQueryBuilder("e");
    if (filter.actor) {
      q.andWhere("(e.actor_id = :actorId OR e.actor_name ILIKE :actorName ESCAPE '\\')", {
        actorId: filter.actor,
        actorName: `%${escapeLike(filter.actor)}%`,
      });
    }
    if (filter.action) q.andWhere("e.action = :action", { action: filter.action });
    if (filter.from) q.andWhere("e.occurred_at >= :from", { from: filter.from });
    if (filter.to) q.andWhere("e.occurred_at <= :to", { to: filter.to });
    if (filter.caseReference) {
      q.andWhere("upper(e.case_reference) = upper(:ref)", { ref: filter.caseReference });
    }
    if (filter.before !== undefined) q.andWhere("e.seq < :before", { before: filter.before });
    return q.orderBy("e.seq", "DESC").take(filter.limit).getMany();
  }

  async actions(): Promise<string[]> {
    const rows = await this.ds
      .getRepository(AuditEventEntity)
      .createQueryBuilder("e")
      .select("e.action", "action")
      .distinct(true)
      .orderBy("e.action", "ASC")
      .getRawMany<{ action: string }>();
    return rows.map((r) => r.action);
  }

  /** A batch of the chain in seq order, after `afterSeq`. */
  async batch(afterSeq: number, size: number): Promise<AuditEventEntity[]> {
    return this.ds
      .getRepository(AuditEventEntity)
      .createQueryBuilder("e")
      .where("e.seq > :afterSeq", { afterSeq })
      .orderBy("e.seq", "ASC")
      .take(size)
      .getMany();
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

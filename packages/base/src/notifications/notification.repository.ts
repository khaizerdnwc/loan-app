import type { Role } from "@loan/core";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager, In, IsNull } from "typeorm";
import { StaffEntity } from "../auth/staff.entity";
import { LoanCaseEntity } from "../cases/entities/loan-case.entity";
import {
  NotificationDeliveryEntity,
  StaffNotificationEntity,
} from "./entities/notification.entities";

/** Storage for staff alerts and the borrower-message log (house/no-datasource-outside-repository). */
@Injectable()
export class NotificationRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** What the rules need to know about the case an event is about. */
  async caseFacts(
    m: EntityManager,
    caseId: string,
  ): Promise<{ reference: string; ownerId: string | null } | null> {
    const c = await m.getRepository(LoanCaseEntity).findOne({
      select: { id: true, reference: true, ownerId: true },
      where: { id: caseId },
    });
    return c ? { reference: c.reference, ownerId: c.ownerId } : null;
  }

  /** An alert; with a dedup key, a second one for the same key is skipped (not an error). */
  async insertAlert(m: EntityManager, alert: Partial<StaffNotificationEntity>): Promise<boolean> {
    const result = await m
      .createQueryBuilder()
      .insert()
      .into(StaffNotificationEntity)
      .values(alert)
      .orIgnore()
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  async insertDelivery(m: EntityManager, d: Partial<NotificationDeliveryEntity>): Promise<void> {
    await m.getRepository(NotificationDeliveryEntity).insert(d);
  }

  /**
   * Claim the oldest waiting message for `leaseSeconds`: one statement that skips a row another
   * sweep has locked or still holds a lease on (FOR UPDATE SKIP LOCKED), so two API instances
   * never send the same message at once. One message per claim, so the lease only has to cover
   * one gateway call. A sweep that dies mid-send leaves its lease to run out and the message is
   * claimed again. A message attempted since `sweepStart` (by this sweep or one running beside
   * it) is left for the next sweep: at most one attempt per message per sweep. Returns the message, the applicant the gateway delivers to (every delivery
   * has a case: FK_notification_delivery_case) and the lease as text: the outcome is written
   * only while that lease is still the row's (recordIfClaimed).
   */
  async claimNext(
    leaseSeconds: number,
    sweepStart: string,
  ): Promise<{ d: NotificationDeliveryEntity; applicantId: string; lease: string } | null> {
    const result = (await this.ds.query(
      `UPDATE notification_delivery SET claimed_until = now() + make_interval(secs => $1)
        WHERE id = (
          SELECT id FROM notification_delivery
           WHERE status = 'PENDING' AND (claimed_until IS NULL OR claimed_until < now())
             AND (last_attempt_at IS NULL OR last_attempt_at < $2::timestamptz)
           ORDER BY created_at, id
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, claimed_until::text AS lease`,
      [leaseSeconds, sweepStart],
    )) as [{ id: string; lease: string }[], number] | { id: string; lease: string }[];
    // TypeORM's postgres driver answers an UPDATE … RETURNING with [rows, rowCount].
    const rows = Array.isArray(result[0])
      ? (result[0] as { id: string; lease: string }[])
      : (result as { id: string; lease: string }[]);
    const claimed = rows[0];
    if (!claimed) return null;
    const d = await this.ds
      .getRepository(NotificationDeliveryEntity)
      .findOneByOrFail({ id: claimed.id });
    const c = await this.ds
      .getRepository(LoanCaseEntity)
      .findOneOrFail({ select: { id: true, applicantId: true }, where: { id: d.caseId } });
    return { d, applicantId: c.applicantId, lease: claimed.lease };
  }

  /** The database's clock, as text: when a sweep starts (claimNext compares against it). */
  async now(): Promise<string> {
    const [row] = (await this.ds.query("SELECT clock_timestamp()::text AS now")) as [
      { now: string },
    ];
    return row.now;
  }

  /** Staff names by id, for "read by" (one query). */
  async staffNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.ds.getRepository(StaffEntity).find({
      select: { id: true, fullName: true },
      where: { id: In(ids) },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  /**
   * Lock one waiting delivery for the rest of the caller's transaction, only while the caller's
   * lease (claimNext) is still on it: a sweep whose lease ran out and was taken over writes
   * nothing.
   */
  async lockClaimed(
    m: EntityManager,
    id: string,
    lease: string,
  ): Promise<NotificationDeliveryEntity | null> {
    return m
      .getRepository(NotificationDeliveryEntity)
      .createQueryBuilder("d")
      .setLock("pessimistic_write")
      .where("d.id = :id", { id })
      .andWhere("d.status = 'PENDING'")
      .andWhere("d.claimed_until = CAST(:lease AS timestamptz)", { lease })
      .getOne();
  }

  async saveDelivery(m: EntityManager, d: NotificationDeliveryEntity): Promise<void> {
    await m.getRepository(NotificationDeliveryEntity).save(d);
  }

  /** Record when an attempt was made, on the database's clock (claimNext compares with it). */
  async stampAttempt(m: EntityManager, id: string): Promise<void> {
    await m
      .getRepository(NotificationDeliveryEntity)
      .createQueryBuilder()
      .update()
      .set({ lastAttemptAt: () => "clock_timestamp()" })
      .where("id = :id", { id })
      .execute();
  }

  async deliveriesFor(caseId: string): Promise<NotificationDeliveryEntity[]> {
    return this.ds.getRepository(NotificationDeliveryEntity).find({
      where: { caseId },
      order: { createdAt: "DESC", id: "ASC" },
      take: 200,
    });
  }

  /** The alerts one staff member sees: theirs, and their role's. Newest first. */
  async alertsFor(staffId: string, role: Role, limit: number): Promise<StaffNotificationEntity[]> {
    return this.ds.getRepository(StaffNotificationEntity).find({
      where: [{ recipientStaffId: staffId }, { recipientStaffId: IsNull(), recipientRole: role }],
      order: { createdAt: "DESC", id: "ASC" },
      take: limit,
    });
  }

  async unreadFor(staffId: string, role: Role): Promise<number> {
    return this.ds.getRepository(StaffNotificationEntity).count({
      where: [
        { recipientStaffId: staffId, readAt: IsNull() },
        { recipientStaffId: IsNull(), recipientRole: role, readAt: IsNull() },
      ],
    });
  }

  async lockAlert(m: EntityManager, id: string): Promise<StaffNotificationEntity | null> {
    return m
      .getRepository(StaffNotificationEntity)
      .createQueryBuilder("n")
      .setLock("pessimistic_write")
      .where("n.id = :id", { id })
      .getOne();
  }

  async saveAlert(m: EntityManager, n: StaffNotificationEntity): Promise<StaffNotificationEntity> {
    return m.getRepository(StaffNotificationEntity).save(n);
  }

  async referencesFor(caseIds: string[]): Promise<Map<string, string>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.ds.getRepository(LoanCaseEntity).find({
      select: { id: true, reference: true },
      where: { id: In(caseIds) },
    });
    return new Map(rows.map((r) => [r.id, r.reference]));
  }

  /** Open cases now in these statuses, with their owner (for breach alerts). */
  async casesIn(
    statuses: string[],
  ): Promise<{ id: string; status: string; ownerId: string | null }[]> {
    if (statuses.length === 0) return [];
    return this.ds.query(
      'SELECT id, status, owner_id AS "ownerId" FROM loan_case WHERE status = ANY($1::text[]) ORDER BY id',
      [statuses],
    );
  }
}

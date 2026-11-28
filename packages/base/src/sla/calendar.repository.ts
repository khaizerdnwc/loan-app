import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource, EntityManager } from "typeorm";
import { BusinessHolidayEntity } from "./entities/business-holiday.entity";
import { BusinessHolidayChangeEntity } from "./entities/business-holiday-change.entity";

/** The advisory-lock key space for calendar dates (intake identities use 4004). */
const CALENDAR_LOCK_SPACE = 4005;

/**
 * All SQL for keeping the business calendar (PRD PLT-005). Writes, and the reads a change
 * depends on, use the caller's manager (the transaction's own connection).
 */
@Injectable()
export class CalendarRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  holidays(): Promise<BusinessHolidayEntity[]> {
    return this.ds.getRepository(BusinessHolidayEntity).find({ order: { date: "ASC" } });
  }

  pendingChanges(): Promise<BusinessHolidayChangeEntity[]> {
    return this.ds
      .getRepository(BusinessHolidayChangeEntity)
      .find({ where: { status: "PENDING" }, order: { holidayDate: "ASC", requestedAt: "ASC" } });
  }

  /**
   * Serialise every change to one date for the rest of the transaction: a transaction-scoped
   * advisory lock in the calendar's key space. A date being added has no row to lock yet, so
   * a row lock cannot do this.
   */
  async lockDate(m: EntityManager, date: string): Promise<void> {
    await m.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [CALENDAR_LOCK_SPACE, date]);
  }

  findHoliday(m: EntityManager, date: string): Promise<BusinessHolidayEntity | null> {
    return m.getRepository(BusinessHolidayEntity).findOne({ where: { date } });
  }

  async insertHoliday(m: EntityManager, date: string, name: string): Promise<void> {
    await m.getRepository(BusinessHolidayEntity).insert({ date, name });
  }

  async deleteHoliday(m: EntityManager, date: string): Promise<void> {
    await m.getRepository(BusinessHolidayEntity).delete({ date });
  }

  findPending(m: EntityManager, date: string): Promise<BusinessHolidayChangeEntity | null> {
    return m
      .getRepository(BusinessHolidayChangeEntity)
      .findOne({ where: { holidayDate: date, status: "PENDING" } });
  }

  /** The date a change is for, read without a lock (so the date's lock can be taken first). */
  async changeDate(m: EntityManager, id: string): Promise<string | null> {
    const row = await m
      .getRepository(BusinessHolidayChangeEntity)
      .findOne({ where: { id }, select: { id: true, holidayDate: true } });
    return row?.holidayDate ?? null;
  }

  /** A change under an update lock, so two decisions on one request serialise. */
  lockChange(m: EntityManager, id: string): Promise<BusinessHolidayChangeEntity | null> {
    return m
      .getRepository(BusinessHolidayChangeEntity)
      .createQueryBuilder("c")
      .setLock("pessimistic_write")
      .where("c.id = :id", { id })
      .getOne();
  }

  newChange(m: EntityManager): BusinessHolidayChangeEntity {
    return m.getRepository(BusinessHolidayChangeEntity).create();
  }

  saveChange(
    m: EntityManager,
    change: BusinessHolidayChangeEntity,
  ): Promise<BusinessHolidayChangeEntity> {
    return m.getRepository(BusinessHolidayChangeEntity).save(change);
  }
}

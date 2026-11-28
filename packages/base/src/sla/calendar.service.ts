import {
  type BusinessCalendarView,
  HolidayChangeAction,
  type HolidayChangeRequest,
  type HolidayView,
  Role,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { StaffRepository } from "../auth/staff.repository";
import {
  forbiddenRole,
  invalidState,
  isUniqueViolation,
  makerChecker,
  notFound,
  validation,
} from "../cases/domain-error";
import { TransactionRunner } from "../database/transaction-runner";
import { manilaDate } from "./business-time";
import { CalendarRepository } from "./calendar.repository";
import { calendarRefusal, isCalendarDate, wordedDate } from "./calendar-rules";
import type { BusinessHolidayChangeEntity } from "./entities/business-holiday-change.entity";

const PENDING_INDEX = "UQ_business_holiday_change_pending_per_date";

/**
 * Keeping the business calendar (PRD PLT-005: holiday calendars, business days).
 *
 * - `business_holiday` stays the only calendar the business clock reads (SlaService); this
 *   service changes its rows, and nothing else.
 * - A change adds or removes one holiday on a day after today (Manila). It is drafted by one
 *   administrator and applied when a different administrator approves it (maker-checker);
 *   either administrator, or the drafter withdrawing it, can reject it. The rules are checked
 *   again on approval: the day may have arrived, or the calendar changed, since the draft.
 * - Every step takes the date's advisory lock (then the change's row lock) and writes its audit
 *   entry in the same transaction, on the transaction's own connection. The audit log is the
 *   calendar's history (it belongs to no case). The date lock also serialises drafts, so "one
 *   pending change per date" cannot race; the partial unique index is a backstop, mapped to
 *   the same 409 after the transaction rejects.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CalendarRepository,
    private readonly staff: StaffRepository,
    private readonly audit: AuditService,
  ) {}

  /** The holidays, for any signed-in user. */
  async holidays(): Promise<HolidayView[]> {
    return (await this.repo.holidays()).map((h) => ({ date: h.date, name: h.name }));
  }

  /** The calendar and its pending changes, with what this administrator may do. */
  async view(user: SessionUser, now = new Date()): Promise<BusinessCalendarView> {
    adminOnly(user);
    const [holidays, pending] = await Promise.all([this.holidays(), this.repo.pendingChanges()]);
    const names = await this.staff.namesById(pending.map((c) => c.requestedBy));
    return {
      today: manilaDate(now),
      holidays,
      pending: pending.map((c) => {
        const own = c.requestedBy === user.id;
        return {
          id: c.id,
          action: c.action,
          date: c.holidayDate,
          name: c.name,
          reason: c.reason,
          requestedByName: names.get(c.requestedBy) ?? c.requestedBy,
          requestedAt: c.requestedAt.toISOString(),
          allowedActions: {
            approve: !own,
            reject: true,
            approveBlockedReason: own
              ? "You drafted this change; a different administrator must approve it."
              : null,
          },
        };
      }),
    };
  }

  /** Draft adding or removing one future holiday, for a second administrator to approve. */
  async requestChange(
    user: SessionUser,
    body: HolidayChangeRequest,
    now = new Date(),
  ): Promise<BusinessCalendarView> {
    adminOnly(user);
    const reason = body.reason?.trim();
    const name = body.name?.trim() ?? "";
    if (!reason) {
      throw validation("Give a reason for the change.", [
        { field: "reason", message: "Enter a reason." },
      ]);
    }
    if (body.action === HolidayChangeAction.Add && !name) {
      throw validation("Name the holiday.", [{ field: "name", message: "Enter a name." }]);
    }
    if (!isCalendarDate(body.date)) {
      throw validation("Enter a real date.", [
        { field: "date", message: "Enter a real date, YYYY-MM-DD." },
      ]);
    }
    const date = body.date;
    try {
      await this.tx.run(async (m) => {
        await this.repo.lockDate(m, date);
        if (await this.repo.findPending(m, date)) throw pendingExists(date);
        const existing = await this.repo.findHoliday(m, date);
        const refusal = calendarRefusal({
          action: body.action,
          date,
          today: manilaDate(now),
          existing,
        });
        if (refusal?.kind === "field") {
          throw validation(refusal.message, [{ field: refusal.field, message: refusal.message }]);
        }
        if (refusal) throw invalidState(refusal.message);
        const change = this.repo.newChange(m);
        change.action = body.action;
        change.holidayDate = date;
        // Removing: the name kept is the holiday's own (refusal above means it exists).
        change.name = body.action === HolidayChangeAction.Add ? name : (existing?.name ?? "");
        change.reason = reason;
        change.status = "PENDING";
        change.requestedBy = user.id;
        change.decidedBy = null;
        change.decidedAt = null;
        change.decisionNote = null;
        const saved = await this.repo.saveChange(m, change);
        await this.audit.append(m, {
          actor: user,
          action: "HOLIDAY_CHANGE_REQUESTED",
          summary: `Asked to ${phrase(change)}; waiting for a second administrator.`,
          details: {
            changeId: saved.id,
            action: change.action,
            date,
            name: change.name,
            before: { holiday: existing ? existing.name : null },
            reason,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, PENDING_INDEX)) throw pendingExists(date);
      throw err;
    }
    return this.view(user, now);
  }

  /** Approve another administrator's change: the calendar changes in this transaction. */
  async approve(
    user: SessionUser,
    changeId: string,
    note?: string,
    now = new Date(),
  ): Promise<BusinessCalendarView> {
    adminOnly(user);
    await this.tx.run(async (m) => {
      const change = await this.lockPending(m, changeId);
      if (change.requestedBy === user.id) {
        throw makerChecker("You drafted this change; a different administrator must approve it.");
      }
      const existing = await this.repo.findHoliday(m, change.holidayDate);
      const refusal = calendarRefusal({
        action: change.action,
        date: change.holidayDate,
        today: manilaDate(now),
        existing,
      });
      if (refusal) throw invalidState(`${refusal.message} Reject this request instead.`);
      if (change.action === HolidayChangeAction.Add) {
        await this.repo.insertHoliday(m, change.holidayDate, change.name);
      } else {
        await this.repo.deleteHoliday(m, change.holidayDate);
      }
      decide(change, "APPROVED", user, note);
      await this.repo.saveChange(m, change);
      await this.audit.append(m, {
        actor: user,
        action: change.action === HolidayChangeAction.Add ? "HOLIDAY_ADDED" : "HOLIDAY_REMOVED",
        summary: `${done(change)}, approving another administrator's request.`,
        details: {
          changeId: change.id,
          date: change.holidayDate,
          before: { holiday: existing ? existing.name : null },
          after: { holiday: change.action === HolidayChangeAction.Add ? change.name : null },
          requestedBy: change.requestedBy,
          reason: change.reason,
          note: change.decisionNote,
        },
      });
    });
    return this.view(user, now);
  }

  /** Reject a change (or withdraw your own); the calendar stays as it is. */
  async reject(
    user: SessionUser,
    changeId: string,
    note?: string,
    now = new Date(),
  ): Promise<BusinessCalendarView> {
    adminOnly(user);
    await this.tx.run(async (m) => {
      const change = await this.lockPending(m, changeId);
      const existing = await this.repo.findHoliday(m, change.holidayDate);
      const withdrawn = change.requestedBy === user.id;
      decide(change, "REJECTED", user, note);
      await this.repo.saveChange(m, change);
      await this.audit.append(m, {
        actor: user,
        action: withdrawn ? "HOLIDAY_CHANGE_WITHDRAWN" : "HOLIDAY_CHANGE_REJECTED",
        summary: withdrawn
          ? `Withdrew the request to ${phrase(change)}.`
          : `Rejected the request to ${phrase(change)}; the calendar stays as it is.`,
        details: {
          changeId: change.id,
          date: change.holidayDate,
          before: { holiday: existing ? existing.name : null },
          after: { holiday: existing ? existing.name : null },
          requested: { action: change.action, name: change.name },
          note: change.decisionNote,
        },
      });
    });
    return this.view(user, now);
  }

  /** The date's lock first (the order drafts use), then the change's row lock. */
  private async lockPending(
    m: EntityManager,
    changeId: string,
  ): Promise<BusinessHolidayChangeEntity> {
    const date = await this.repo.changeDate(m, changeId);
    if (!date) throw notFound("change request");
    await this.repo.lockDate(m, date);
    const change = await this.repo.lockChange(m, changeId);
    if (!change) throw notFound("change request");
    if (change.status !== "PENDING") {
      throw invalidState(`This change was already ${change.status.toLowerCase()}.`);
    }
    return change;
  }
}

function decide(
  change: BusinessHolidayChangeEntity,
  status: "APPROVED" | "REJECTED",
  user: SessionUser,
  note?: string,
): void {
  change.status = status;
  change.decidedBy = user.id;
  change.decidedAt = new Date();
  change.decisionNote = note?.trim() || null;
}

/** The calendar is the administrators' (the controller's @Roles is the first gate). */
function adminOnly(user: SessionUser): void {
  if (user.role !== Role.Admin) {
    throw forbiddenRole("Only an administrator can change the business calendar.");
  }
}

const pendingExists = (date: string) =>
  invalidState(
    `A change to ${wordedDate(date)} is already waiting for approval. Approve or reject it first.`,
  );

/** "add 2026-12-29 (Typhoon suspension) as a holiday", for summaries. */
const phrase = (c: BusinessHolidayChangeEntity) =>
  c.action === HolidayChangeAction.Add
    ? `add ${c.holidayDate} (${c.name}) as a holiday`
    : `remove the ${c.holidayDate} holiday (${c.name})`;

const done = (c: BusinessHolidayChangeEntity) =>
  c.action === HolidayChangeAction.Add
    ? `Added ${c.holidayDate} (${c.name}) as a holiday`
    : `Removed the ${c.holidayDate} holiday (${c.name})`;

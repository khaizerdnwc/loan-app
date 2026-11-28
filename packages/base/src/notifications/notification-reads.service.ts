import {
  type BorrowerMessageView,
  CaseStatus,
  SlaState,
  STATUS_LABEL,
  type StaffNotificationList,
  type StaffNotificationView,
} from "@loan/core";
import { Injectable } from "@nestjs/common";
import type { SessionUser } from "../auth/session";
import { CasesService } from "../cases/cases.service";
import { notFound } from "../cases/domain-error";
import { TransactionRunner } from "../database/transaction-runner";
import { SlaService } from "../sla/sla.service";
import { SLA_POLICY } from "../sla/sla-policy";
import type { StaffNotificationEntity } from "./entities/notification.entities";
import { NotificationRepository } from "./notification.repository";

/**
 * The reads and the time-based alerts around notifications: a staff member's alerts (theirs
 * and their role's), marking one read, a case's borrower-message log (the case's own
 * visibility), and SLA-breach alerts from the stage clocks (one per stage visit, deduplicated
 * by ON CONFLICT DO NOTHING on a partial unique index, never mapped to an error). Kept apart
 * from NotificationService, which ActivityService calls inside every case transaction, so the
 * case services never depend on these.
 */
@Injectable()
export class NotificationReadsService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly tx: TransactionRunner,
    private readonly cases: CasesService,
    private readonly sla: SlaService,
  ) {}

  async list(user: SessionUser): Promise<StaffNotificationList> {
    const [rows, unread] = await Promise.all([
      this.repo.alertsFor(user.id, user.role, 50),
      this.repo.unreadFor(user.id, user.role),
    ]);
    const refs = await this.repo.referencesFor(
      [...new Set(rows.map((r) => r.caseId))].filter((x): x is string => !!x),
    );
    const names = await this.repo.staffNames(
      [...new Set(rows.map((r) => r.readBy))].filter((x): x is string => !!x),
    );
    return { items: rows.map((r) => view(r, refs, names)), unread };
  }

  /** Mark an alert read; one addressed to the reader's role is read for the whole role. */
  async markRead(user: SessionUser, id: string): Promise<StaffNotificationView> {
    const saved = await this.tx.run(async (m) => {
      const n = await this.repo.lockAlert(m, id);
      const mine =
        n &&
        (n.recipientStaffId === user.id ||
          (n.recipientStaffId === null && n.recipientRole === user.role));
      if (!n || !mine) throw notFound("notification");
      if (n.readAt) return n;
      n.readAt = new Date();
      n.readBy = user.id;
      return this.repo.saveAlert(m, n);
    });
    const refs = await this.repo.referencesFor(saved.caseId ? [saved.caseId] : []);
    const names = await this.repo.staffNames(saved.readBy ? [saved.readBy] : []);
    return view(saved, refs, names);
  }

  async messages(user: SessionUser, caseId: string): Promise<BorrowerMessageView[]> {
    await this.cases.visible(user, caseId);
    return (await this.repo.deliveriesFor(caseId)).map((d) => ({
      id: d.id,
      channel: d.channel,
      template: d.template,
      recipient: d.recipientLabel,
      subject: d.subject,
      body: d.body,
      status: d.status,
      attempts: d.attempts,
      providerReference: d.providerReference,
      providerMode: d.providerMode,
      lastError: d.lastError,
      createdAt: d.createdAt.toISOString(),
      sentAt: d.sentAt?.toISOString() ?? null,
    }));
  }

  /**
   * Alert whoever acts next on every case past its SLA (PRD WF-003, NTF-002): the owning loan
   * officer in review when the case has one, otherwise the stage's role. One alert per stage
   * visit (dedup key: case, stage, entry time). Returns how many new alerts were written.
   */
  async alertBreaches(now = new Date()): Promise<number> {
    const open = await this.repo.casesIn(Object.keys(SLA_POLICY));
    const clocks = await this.sla.forCases(
      open.map((c) => ({ id: c.id, status: c.status as CaseStatus })),
      now,
    );
    const owner = new Map(open.map((c) => [c.id, c.ownerId]));
    const refs = await this.repo.referencesFor(clocks.map((c) => c.caseId));
    let written = 0;
    for (const clock of clocks) {
      if (clock.state !== SlaState.Breached) continue;
      const policy = SLA_POLICY[clock.status];
      if (!policy) continue;
      const staffId = clock.status === CaseStatus.Review ? (owner.get(clock.caseId) ?? null) : null;
      const inserted = await this.tx.run((m) =>
        this.repo.insertAlert(m, {
          recipientRole: policy.role,
          recipientStaffId: staffId,
          caseId: clock.caseId,
          kind: "SLA_BREACHED",
          title: `${refs.get(clock.caseId) ?? "A case"} is past its SLA (${STATUS_LABEL[clock.status]})`,
          dedupKey: `sla:${clock.caseId}:${clock.status}:${clock.enteredAt}`,
        }),
      );
      if (inserted) written += 1;
    }
    return written;
  }
}

function view(
  n: StaffNotificationEntity,
  refs: Map<string, string>,
  names: Map<string, string>,
): StaffNotificationView {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    caseId: n.caseId,
    caseReference: n.caseId ? (refs.get(n.caseId) ?? null) : null,
    forRole: n.recipientStaffId ? null : n.recipientRole,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    readByName: n.readBy ? (names.get(n.readBy) ?? null) : null,
  };
}

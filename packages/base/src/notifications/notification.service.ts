import { randomUUID } from "node:crypto";
import {
  isProviderUnavailable,
  type MessageChannel,
  NOTIFICATIONS,
  type Notifications,
  type ProviderFailure,
} from "@loan/contracts";
import type { CaseStatus } from "@loan/core";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { TransactionRunner } from "../database/transaction-runner";
import { NotificationRepository } from "./notification.repository";
import { BORROWER_TEMPLATES, planFor } from "./notification-rules";

/** Attempts before a borrower message is given up on (each sweep is one attempt). */
export const MAX_ATTEMPTS = 5;

/**
 * How long a sweep holds a claimed message before another sweep may take it. One message per
 * claim, so it covers one gateway call (simulated timeout 3 s by default) with a wide margin.
 */
const CLAIM_LEASE_SECONDS = 120;

const GATEWAY = "The email/SMS gateway (simulated)";
const FAILURE_WORDS: Record<ProviderFailure, string> = {
  OUTAGE: `${GATEWAY} was unavailable.`,
  TIMEOUT: `${GATEWAY} did not answer in time.`,
  MALFORMED: `${GATEWAY} sent a reply that could not be read.`,
};

/**
 * Why an attempt failed, in words staff can read: the provider failure's kind, or that an
 * unexpected error happened. Never the error's message or class (the class is logged on the
 * server only), which could carry anything.
 */
export function failureInWords(err: unknown): string {
  if (isProviderUnavailable(err)) {
    return FAILURE_WORDS[err.failure] ?? `${GATEWAY} could not take the message.`;
  }
  return "The message could not be handed to the email/SMS gateway (simulated) because of an unexpected error.";
}

const RECIPIENT: Record<MessageChannel, string> = {
  EMAIL: "Applicant, email on file",
  SMS: "Applicant, mobile number on file",
};

export interface CaseEvent {
  caseId: string;
  actorId: string;
  action: string;
  toStatus: CaseStatus | null;
  details: Record<string, unknown>;
}

/**
 * Notifications (PRD NTF-001..003). `onActivity` runs inside the transaction of every case
 * event (ActivityService, on its manager: one connection) and writes the staff alerts and the
 * borrower-message outbox rows the rules call for, so they commit with the change or not at
 * all. `dispatchPending` hands waiting messages to the gateway later, outside any transaction
 * (no provider call inside tx.run): an outage leaves them waiting for the next sweep and never
 * touches the case.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly tx: TransactionRunner,
    @Inject(NOTIFICATIONS) private readonly gateway: Notifications,
  ) {}

  async onActivity(m: EntityManager, e: CaseEvent): Promise<void> {
    const facts = await this.repo.caseFacts(m, e.caseId);
    if (!facts) return;
    const plan = planFor({ ...e, reference: facts.reference, ownerId: facts.ownerId });
    for (const a of plan.alerts) {
      await this.repo.insertAlert(m, {
        recipientRole: a.role,
        recipientStaffId: a.staffId,
        caseId: e.caseId,
        kind: a.kind,
        title: a.title,
        dedupKey: null,
      });
    }
    for (const msg of plan.messages) {
      const words = BORROWER_TEMPLATES[msg.template];
      for (const channel of msg.channels) {
        await this.repo.insertDelivery(m, {
          caseId: e.caseId,
          channel,
          template: msg.template,
          recipientLabel: RECIPIENT[channel],
          subject: words.subject,
          body: words.body.replace("{ref}", facts.reference),
          idempotencyKey: `msg-${randomUUID()}`,
          status: "PENDING",
          attempts: 0,
          providerReference: null,
          providerMode: null,
          lastError: null,
          sentAt: null,
        });
      }
    }
  }

  /**
   * Hand waiting messages to the gateway, one call each, none inside a transaction. Messages
   * are claimed one at a time (claimNext: FOR UPDATE SKIP LOCKED plus a lease), so concurrent
   * sweeps never send the same one, and an outcome is written only under the sweep's own lease. Any error on one message is that message's failed attempt (its
   * kind in words, never the error's text), so one bad message cannot stall the rest.
   */
  async dispatchPending(limit = 50): Promise<{ sent: number; waiting: number; failed: number }> {
    const counts = { sent: 0, waiting: 0, failed: 0 };
    // One attempt per message per sweep, also beside a concurrent sweep: a message attempted
    // since this sweep started waits for the next one.
    const sweepStart = await this.repo.now();
    for (let i = 0; i < limit; i += 1) {
      const claimed = await this.repo.claimNext(CLAIM_LEASE_SECONDS, sweepStart);
      if (!claimed) break;
      const { d, applicantId, lease } = claimed;
      let outcome: { ok: true; reference: string; mode: string } | { ok: false; error: string };
      try {
        const receipt = await this.gateway.send({
          idempotencyKey: d.idempotencyKey,
          channel: d.channel,
          recipientRef: `applicant:${applicantId}`,
          template: d.template,
          subject: d.subject,
          body: d.body,
        });
        outcome = { ok: true, reference: receipt.reference, mode: receipt.mode };
      } catch (err) {
        if (!isProviderUnavailable(err)) {
          // The class only, and the message's id: never the error's text or applicant data.
          this.logger.warn(
            `Borrower message ${d.id}: unexpected error (${err instanceof Error ? err.name : "unknown"}).`,
          );
        }
        outcome = { ok: false, error: failureInWords(err) };
      }
      await this.tx.run(async (m) => {
        const row = await this.repo.lockClaimed(m, d.id, lease);
        if (!row) return;
        row.claimedUntil = null;
        row.attempts += 1;
        if (outcome.ok) {
          row.status = "SENT";
          row.providerReference = outcome.reference;
          row.providerMode = outcome.mode;
          row.lastError = null;
          row.sentAt = new Date();
          counts.sent += 1;
        } else {
          row.lastError = outcome.error;
          row.status = row.attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
          if (row.status === "FAILED") counts.failed += 1;
          else counts.waiting += 1;
        }
        await this.repo.saveDelivery(m, row);
        // On the database's clock, the one the sweep start is read from.
        await this.repo.stampAttempt(m, row.id);
      });
    }
    return counts;
  }
}

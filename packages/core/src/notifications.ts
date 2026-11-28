/**
 * The HTTP contract for notifications (PRD NTF-001..003): staff alerts in the backoffice,
 * and the per-case log of messages to the borrower (sent through a simulated gateway).
 */
import type { Role } from "./domain";

/** An in-app alert for staff (NTF-002). */
export interface StaffNotificationView {
  id: string;
  kind: string;
  title: string;
  caseId: string | null;
  caseReference: string | null;
  /** Whether it was addressed to the reader alone (an assignment) or to their whole role. */
  forRole: Role | null;
  createdAt: string;
  readAt: string | null;
  /** Who marked it read (a role alert is read once for everyone in the role). */
  readByName: string | null;
}

export interface StaffNotificationList {
  items: StaffNotificationView[];
  unread: number;
}

export const DeliveryStatus = {
  /** Waiting for the gateway (a retry after an outage waits here too). */
  Pending: "PENDING",
  Sent: "SENT",
  /** Gave up after the last attempt. */
  Failed: "FAILED",
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: "Waiting to send",
  SENT: "Sent",
  FAILED: "Not sent",
};

/** One message to the borrower and what became of it (NTF-001, NTF-003). */
export interface BorrowerMessageView {
  id: string;
  channel: "EMAIL" | "SMS";
  template: string;
  recipient: string;
  subject: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  providerReference: string | null;
  /** The gateway's mode (SIMULATED in this release), once it accepted the message. */
  providerMode: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

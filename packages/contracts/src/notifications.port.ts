import type { ProviderMode } from "@loan/core";

/**
 * Borrower messages by email or SMS (PRD NTF-001). Lending sends a template and its words;
 * the provider knows where to deliver from the recipient reference (the applicant on file),
 * so no address or phone number passes through lending. In this release the gateway is
 * simulated and nothing is delivered to anyone.
 */
export type MessageChannel = "EMAIL" | "SMS";

export interface OutboundMessage {
  /** One key per message: a retry after a timeout never sends a second copy. */
  idempotencyKey: string;
  channel: MessageChannel;
  /** Who to deliver to, as the provider knows them (e.g. the applicant's id), never an address. */
  recipientRef: string;
  template: string;
  subject: string;
  body: string;
}

export interface MessageReceipt {
  provider: string;
  mode: ProviderMode;
  idempotencyKey: string;
  /** The gateway's reference for the message, e.g. MSG-00000001. */
  reference: string;
  channel: MessageChannel;
  acceptedAt: string;
}

export interface Notifications {
  /**
   * Hand a message to the gateway. Every implementation MUST be idempotent on
   * `idempotencyKey`: a repeat with the same key (a retry after a timeout or an unreadable
   * reply, or a second API instance's sweep) returns the first receipt and never delivers a
   * second message. Lending relies on this; a provider that cannot honour it needs an adapter
   * that does (store the key, answer the stored receipt). Throws
   * ProviderUnavailableError on outage, timeout or a malformed reply (lending then retries
   * later: a message never blocks or changes a case).
   */
  send(message: OutboundMessage): Promise<MessageReceipt>;
}

export const NOTIFICATIONS = "NOTIFICATIONS_PORT";

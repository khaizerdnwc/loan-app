import type { Grade, Role } from "@loan/core";

/** What the session token carries, and what every handler sees as `@CurrentUser()`. */
export interface SessionUser {
  id: string;
  fullName: string;
  role: Role;
}

/** Approver authority, read from the database at decision time — never from the token. */
export interface ApprovalAuthority {
  limit: string;
  grades: Grade[];
}

export const SESSION_COOKIE = "session";
/** A working day: the demo personas sign in again after that. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

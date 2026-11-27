import type { ProblemCode } from "./problem";

/**
 * Per-product automation (PRD §7.5, AIS-007, F8). The rules and the score always run; the
 * mode decides what their outcome does to the case:
 *   OFF     every application goes to a person.
 *   SHADOW  the engine's outcome is recorded, and a person decides.
 *   LIVE    the engine's outcome moves the case (approve, refer, decline).
 * The kill switch overrides any mode: while it is on, every new application goes to a person.
 */
export const AutomationMode = { Off: "OFF", Shadow: "SHADOW", Live: "LIVE" } as const;
export type AutomationMode = (typeof AutomationMode)[keyof typeof AutomationMode];
export const AUTOMATION_MODES: readonly AutomationMode[] = Object.values(AutomationMode);

export const AUTOMATION_MODE_LABEL: Record<AutomationMode, string> = {
  OFF: "Off",
  SHADOW: "Shadow mode",
  LIVE: "Live",
};

/** What a change request asks for: a new mode, or turning the kill switch back off. */
export type AutomationChangeKind = "SET_MODE" | "KILL_SWITCH_OFF";
export type AutomationChangeStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** A change to a product's automation, drafted by one administrator for another to approve. */
export interface AutomationChangeView {
  id: string;
  productCode: string;
  kind: AutomationChangeKind;
  /** The mode asked for (SET_MODE), or null (KILL_SWITCH_OFF). */
  requestedMode: AutomationMode | null;
  /** The mode when the change was drafted. */
  fromMode: AutomationMode;
  reason: string;
  status: AutomationChangeStatus;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export type AutomationAction =
  | "REQUEST_MODE_CHANGE"
  | "KILL_SWITCH_ON"
  | "REQUEST_KILL_SWITCH_OFF"
  | "APPROVE_CHANGE"
  /** Close another administrator's request unchanged. */
  | "REJECT_CHANGE"
  /** Close your own request unchanged (the same endpoint as a rejection). */
  | "WITHDRAW_CHANGE";

export type AutomationActionAvailability =
  | { action: AutomationAction; enabled: true }
  | { action: AutomationAction; enabled: false; blockedBy: ProblemCode; detail: string };

export interface AutomationView {
  productCode: string;
  productName: string;
  mode: AutomationMode;
  killSwitch: boolean;
  killSwitchSetByName: string | null;
  killSwitchSetAt: string | null;
  updatedAt: string;
  /** At most one change waits for approval per product. */
  pendingChange: AutomationChangeView | null;
  /** What the caller may do now; the API refuses the same things with the same reasons. */
  allowedActions: AutomationActionAvailability[];
}

/** Insert-only history of a product's automation (who, what, when, before and after). */
export interface AutomationEventView {
  id: string;
  productCode: string;
  action: string;
  summary: string;
  actorName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type AutomationChangeRequest =
  | { kind: "SET_MODE"; mode: AutomationMode; reason: string }
  | { kind: "KILL_SWITCH_OFF"; reason: string };

export interface KillSwitchRequest {
  reason: string;
}

export interface DecideAutomationChangeRequest {
  note?: string;
}

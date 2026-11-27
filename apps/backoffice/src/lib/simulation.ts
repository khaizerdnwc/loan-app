import type { CoreBankingSimulationMode } from "@loan/core";

/** One name per failure mode, used on the simulation screen and the warning banner. */
export const MODE_LABEL: Record<CoreBankingSimulationMode, string> = {
  OK: "Answering normally",
  OUTAGE: "Outage",
  TIMEOUT: "Timeout",
  MALFORMED: "Malformed reply",
  LOST_REPLY: "Account created, reply lost",
};

/** What the mode does to the next call, so an administrator can predict it before switching. */
export const MODE_EFFECT: Record<CoreBankingSimulationMode, string> = {
  OK: "The service answers normally again.",
  OUTAGE:
    "The service refuses every call. A new application that needs it is referred instead of declined; a booking that needs it fails and can be retried with the same key.",
  TIMEOUT:
    "The service does not answer in time. Applications are referred; a booking fails and can be retried with the same key.",
  MALFORMED:
    "The service answers with a reply that cannot be read, which is refused. Applications are referred; a booking fails, stores nothing and can be retried.",
  LOST_REPLY:
    "Core banking opens the loan account but its reply never arrives, so the booking fails. A retry with the same key finds that account instead of opening a second one.",
};

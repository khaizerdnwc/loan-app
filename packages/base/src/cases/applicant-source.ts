/**
 * Where an applicant's facts came from (PRD INT-002, INT-005). Seeded personas stand in for
 * customers already in core; a walk-in captured from a core lookup carries its customer
 * number; a walk-in captured by hand (new to the bank) has neither, and its id starts with
 * WALK_IN_ID_PREFIX. Pure: no clock, no write.
 */
export const WALK_IN_ID_PREFIX = "APL-W";

/**
 * Whether the applicant's deposit account comes from the system of record (core banking, or a
 * seeded persona standing in for it), never from something staff typed. Only such an account
 * can be called verified for disbursement.
 */
export function accountFromSystemOfRecord(a: {
  id: string;
  customerNumber: string | null;
}): boolean {
  return a.customerNumber !== null || !a.id.startsWith(WALK_IN_ID_PREFIX);
}

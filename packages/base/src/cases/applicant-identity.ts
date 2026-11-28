import { identityKey as screeningKey } from "@loan/contracts";
import type { ApplicantEntity } from "./entities/applicant.entity";

/**
 * Who an applicant is, as staff and files can tell: name, birth date and the government ID's
 * last 4 digits. Walk-in capture (WI-1) and email and file intake (INT-010) both match and lock on
 * it, so one person is on record once (intake/ uses this; nothing here imports intake/).
 */
export interface Identity {
  fullName: string;
  birthDate: string;
  governmentIdLast4: string;
}

/** The customers on record with an identity: none, exactly one, or several (an ambiguity). */
export type IdentityMatch =
  | { kind: "none" }
  | { kind: "one"; applicant: ApplicantEntity }
  | { kind: "many"; applicants: ApplicantEntity[] };

/** A name or employer compared without case, punctuation or repeated spaces. */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The identity as one comparable key: the authority for duplicates (the capture lock). It is
 * contracts' `identityKey` over the name as `normaliseName` folds it — the same function the
 * match compares names with, so the lock and the match cannot disagree on who is one person
 * ("Dela Paz" and "Dela-Paz" are). Screening keeps contracts' narrower key (no punctuation
 * folding) on purpose: the simulated screening profiles are seeded by it, and changing it would
 * move who the simulated watchlist matches.
 */
export function identityKey(identity: Identity): string {
  return screeningKey({ ...identity, fullName: normaliseName(identity.fullName) });
}

/** The same person: name as compared, birth date and ID ending all agree. */
export function sameIdentity(a: Identity, b: Identity): boolean {
  return identityKey(a) === identityKey(b);
}

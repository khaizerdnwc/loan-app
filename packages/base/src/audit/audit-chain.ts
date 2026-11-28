import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../decisioning/engine";

/** The link before the first entry. */
export const GENESIS_HASH = "0".repeat(64);

/** The fields an audit entry's hash covers: everything but the hashes themselves. */
export interface ChainedFields {
  seq: number;
  occurredAt: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  caseId: string | null;
  caseReference: string | null;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * sha256(previous hash + canonical JSON of the entry). Canonical JSON sorts keys at every
 * level, so the same entry read back from jsonb (which reorders keys) hashes the same.
 */
export function chainHash(prevHash: string, fields: ChainedFields): string {
  return createHash("sha256")
    .update(prevHash + canonicalJson(fields))
    .digest("hex");
}

/** Details as they will read back from jsonb: plain JSON values only (a Date becomes its ISO text). */
export function plainDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(details ?? {})) as Record<string, unknown>;
}

export interface StoredLink extends ChainedFields {
  prevHash: string;
  hash: string;
}

export interface ChainCheck {
  checked: number;
  firstBrokenSeq: number | null;
  problem: string | null;
  last: { seq: number; hash: string } | null;
}

/**
 * Walk entries in seq order, continuing from `from` (the last entry of the previous batch,
 * or null at the start). Stops at the first entry whose seq, link or hash does not hold.
 */
export function checkLinks(
  entries: StoredLink[],
  from: { seq: number; hash: string } | null,
  checkedBefore = 0,
): ChainCheck {
  let previous = from;
  let checked = checkedBefore;
  for (const e of entries) {
    const expectedSeq = previous ? previous.seq + 1 : 1;
    const expectedPrev = previous ? previous.hash : GENESIS_HASH;
    const { prevHash, hash, ...fields } = e;
    let problem: string | null = null;
    if (e.seq !== expectedSeq) {
      problem = `entry ${expectedSeq} is missing (found ${e.seq} next)`;
    } else if (!sameHash(prevHash, expectedPrev)) {
      problem = `entry ${e.seq} does not link to the entry before it`;
    } else if (!sameHash(chainHash(prevHash, fields), hash)) {
      problem = `entry ${e.seq} was changed after it was written`;
    }
    if (problem) {
      return {
        checked,
        firstBrokenSeq: e.seq === expectedSeq ? e.seq : expectedSeq,
        problem,
        last: previous,
      };
    }
    checked += 1;
    previous = { seq: e.seq, hash };
  }
  return { checked, firstBrokenSeq: null, problem: null, last: previous };
}

/** Hex digests compared in constant time (they are not secrets, but it costs nothing). */
function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

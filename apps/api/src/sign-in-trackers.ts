import { normalizeIp } from "@nestjs/throttler";

/**
 * Throttle keys for sign-in (the throttlers in app.module.ts; limits in SIGN_IN_LIMITS).
 *
 * The address is normalised the way the throttler's own default tracker does it: an
 * IPv4-mapped IPv6 address counts as the IPv4 address, and an IPv6 address counts as its /64,
 * so one host rotating addresses inside its prefix stays in one bucket. Behind the backoffice
 * the address is the client's when a trusted balancer supplied it (H8), so it must not be a
 * value a client can vary freely.
 */

interface SignInRequest {
  ip?: string;
  body?: { username?: unknown };
}

/** The address a sign-in counts against: IPv4, or an IPv6 /64. */
export function sourceKey(ip: string | undefined): string {
  return ip ? String(normalizeIp(ip)) : "unknown";
}

/** The account a sign-in names, as the service looks it up (trimmed, lower case). */
export function accountKey(req: SignInRequest): string {
  const username = req.body?.username;
  return typeof username === "string" ? username.trim().toLowerCase().slice(0, 40) : "";
}

/** `signInAccount`: one account from one source. */
export function signInAccountTracker(req: SignInRequest): string {
  return `${sourceKey(req.ip)}|${accountKey(req)}`;
}

/**
 * `signInAccountGlobal`: one account from every source together, so many addresses cannot
 * multiply the guesses on one account. Someone can lock an account out for a minute this way;
 * that is the accepted trade-off (docs/ASSUMPTIONS.md "Rate limits").
 */
export function signInAccountGlobalTracker(req: SignInRequest): string {
  return `account|${accountKey(req)}`;
}

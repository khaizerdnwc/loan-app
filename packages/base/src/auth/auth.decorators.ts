import type { Role } from "@loan/core";
import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { SessionUser } from "./session";

export const ROLES_KEY = "loan:roles";
export const PUBLIC_KEY = "loan:public";
export const SIGN_IN_KEY = "loan:sign-in";

/** The roles allowed to call a handler. The global guard denies everyone else (403). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** An endpoint that needs no sign-in (health, persona list, demo sign-in). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** The signed-in staff member, set by the session guard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser =>
    ctx.switchToHttp().getRequest<{ user: SessionUser }>().user,
);

/**
 * Marks the sign-in handler, so the composition root can apply the per-account sign-in
 * throttle to it (and only it) without matching on a path string.
 */
export const SignInRoute = () => SetMetadata(SIGN_IN_KEY, true);

/**
 * Sign-in limits, a minute each: per account from one source (address + username), per account
 * from every source together (username alone, so many addresses cannot multiply the guesses on
 * one account), and per source address. IPv6 sources count per /64.
 */
export const SIGN_IN_LIMITS = {
  perAccount: 20,
  perAccountGlobal: 60,
  perSource: 60,
  ttlMs: 60_000,
} as const;

import { SIGN_IN_KEY, sessionTokenFrom } from "@loan/base";
import { type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * The throttle guard, keyed on the signed-in staff member where there is one.
 *
 * Behind the backoffice proxy every browser reaches the API from the proxy's address, so a
 * per-address bucket would be shared by every user. A request whose session token verifies
 * is counted against `staff:<id>`; anything else (no token, a forged or expired one) falls
 * back to the caller's address, so inventing tokens cannot buy a fresh bucket. The key is
 * never a client-chosen value: only a token signed with JWT_SECRET names a staff bucket.
 *
 * Sign-in is always counted per address: its per-source cap must not be split by whatever
 * session cookie the caller already holds. A throttler that sets its own `getTracker` (the
 * per-account sign-in throttler in app.module.ts) is not affected by this class.
 */
@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  @Inject(JwtService) private readonly jwt!: JwtService;

  protected override async getTracker(
    req: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    const signIn = context && Reflect.getMetadata(SIGN_IN_KEY, context.getHandler()) === true;
    if (!signIn) {
      const token = sessionTokenFrom(req as Parameters<typeof sessionTokenFrom>[0]);
      if (token) {
        try {
          const { sub } = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
          if (typeof sub === "string" && sub !== "") return `staff:${sub}`;
        } catch {
          // Not a valid session: counted against the address below.
        }
      }
    }
    return super.getTracker(req);
  }
}

import { ProblemCode, type Role } from "@loan/core";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PUBLIC_KEY, ROLES_KEY } from "./auth.decorators";
import { SESSION_COOKIE, type SessionUser } from "./session";
import { StaffRepository } from "./staff.repository";

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  user?: SessionUser;
}

/**
 * The one global guard (registered in the API's composition root). It fails closed:
 *  - no session on a non-public route → 401;
 *  - a route that declares no @Roles → 403 (house/require-roles-on-controller-handler
 *    makes that a lint error too);
 *  - a role not in @Roles → 403.
 * The token carries only the staff id: role and name are re-read from the staff table on
 * every request, so a changed or removed staff member loses access at once.
 * Rules about the case itself (maker-checker, authority, state) are enforced in the
 * services, where the case is loaded.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly staff: StaffRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const token = sessionTokenFrom(request);
    if (!token) {
      throw new UnauthorizedException({
        code: ProblemCode.Unauthenticated,
        detail: "Sign in to continue.",
      });
    }
    const ended = new UnauthorizedException({
      code: ProblemCode.Unauthenticated,
      detail: "Your session has ended. Sign in again.",
    });
    let staffId: string;
    try {
      staffId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw ended;
    }
    const member = await this.staff.findById(staffId);
    if (!member) throw ended;
    const user: SessionUser = { id: member.id, fullName: member.fullName, role: member.role };
    request.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (!roles || !roles.includes(user.role)) {
      throw new ForbiddenException({
        code: ProblemCode.Forbidden,
        detail: "Your role cannot do this.",
      });
    }
    return true;
  }
}

/**
 * The session token a request carries: the session cookie, else a Bearer header. Unverified;
 * callers verify it (this guard, and the API's per-user throttle tracker).
 */
export function sessionTokenFrom(request: Pick<RequestLike, "headers" | "cookies">): string | null {
  const cookie = request.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (value?.startsWith("Bearer ")) return value.slice("Bearer ".length);
  return null;
}

import { ProblemCode, Role, type StaffView } from "@loan/core";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsString, Length } from "class-validator";
import { LENDING_OPTIONS, type LendingModuleOptions } from "../lending.options";
import { CurrentUser, Public, Roles, SIGN_IN_LIMITS, SignInRoute } from "./auth.decorators";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionUser } from "./session";
import { StaffRepository } from "./staff.repository";
import { toStaffView } from "./staff.view";

class SignInDto {
  @IsString()
  @Length(1, 40)
  username!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

/** The subset of Express's response this controller uses. */
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
}

const ALL_ROLES = Object.values(Role);

/**
 * Test sign-in (Program Mechanics 1a: "test sign-in … for at least three seeded roles").
 * Each seeded staff member has a username and a scrypt-hashed test password
 * (docs/ASSUMPTIONS.md); there is no password-less route. The session is a signed JWT
 * carrying only the staff id, in an httpOnly, SameSite=Lax cookie (Secure in production).
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  /** A hash to check against when the username is unknown, so timing does not reveal it. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly staff: StaffRepository,
    private readonly jwt: JwtService,
    @Inject(LENDING_OPTIONS) private readonly options: LendingModuleOptions,
  ) {}

  @Post("sign-in")
  @Public()
  @SignInRoute()
  @HttpCode(200)
  // Per source address (every browser behind the proxy shares one), and per account through
  // the `signInAccount` throttler the composition root applies to @SignInRoute handlers.
  @Throttle({
    default: { limit: SIGN_IN_LIMITS.perSource, ttl: SIGN_IN_LIMITS.ttlMs },
    signInAccount: { limit: SIGN_IN_LIMITS.perAccount, ttl: SIGN_IN_LIMITS.ttlMs },
  })
  async signIn(
    @Body() body: SignInDto,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<StaffView> {
    const member = await this.staff.findForSignIn(body.username.trim().toLowerCase());
    this.dummyHash ??= hashPassword("not-a-real-account");
    // Unknown users, and staff whose hash is still the migration's placeholder, are checked
    // against the dummy hash, so every refusal costs one scrypt run.
    const usable = member?.passwordHash.startsWith("scrypt$") ? member.passwordHash : null;
    const ok = await verifyPassword(body.password, usable ?? (await this.dummyHash));
    if (!member || !usable || !ok) {
      throw new UnauthorizedException({
        code: ProblemCode.Unauthenticated,
        detail: "The username or password is not correct.",
      });
    }
    const token = await this.jwt.signAsync({ sub: member.id }, { expiresIn: SESSION_TTL_SECONDS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.options.cookieSecure,
      path: "/",
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    return toStaffView(member);
  }

  @Post("logout")
  @Roles(...ALL_ROLES)
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: CookieResponse): void {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  @Roles(...ALL_ROLES)
  async me(@CurrentUser() user: SessionUser): Promise<StaffView> {
    const member = await this.staff.findById(user.id);
    if (!member)
      throw new NotFoundException({ code: ProblemCode.NotFound, detail: "No such persona." });
    return toStaffView(member);
  }
}

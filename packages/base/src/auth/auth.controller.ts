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
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsString, Length } from "class-validator";
import { LENDING_OPTIONS, type LendingModuleOptions } from "../lending.options";
import { CurrentUser, Public, Roles } from "./auth.decorators";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionUser } from "./session";
import { StaffRepository } from "./staff.repository";
import { toStaffView } from "./staff.view";

class DemoLoginDto {
  @IsString()
  @Length(1, 40)
  staffId!: string;
}

/** The subset of Express's response this controller uses. */
interface CookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void;
  clearCookie(name: string, options: Record<string, unknown>): void;
}

const ALL_ROLES = Object.values(Role);

/**
 * Demo sign-in (mechanics 1a: "test sign-in or equivalent controlled demo access"). Anyone
 * who can reach the app can pick a persona; that is a stated limitation of the demo, not a
 * production design. The session is a signed JWT in an httpOnly, SameSite=Lax cookie.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly staff: StaffRepository,
    private readonly jwt: JwtService,
    @Inject(LENDING_OPTIONS) private readonly options: LendingModuleOptions,
  ) {}

  @Get("personas")
  @Public()
  async personas(): Promise<StaffView[]> {
    return (await this.staff.list()).map(toStaffView);
  }

  @Post("demo-login")
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async login(
    @Body() body: DemoLoginDto,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<StaffView> {
    const member = await this.staff.findById(body.staffId);
    if (!member) {
      throw new NotFoundException({ code: ProblemCode.NotFound, detail: "No such persona." });
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

import { type BusinessCalendarView, type HolidayView, Role } from "@loan/core";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { DecideHolidayChangeDto, HolidayChangeDto } from "./calendar.dto";
import { CalendarService } from "./calendar.service";

const ALL_ROLES = Object.values(Role);

/**
 * The business calendar (PRD PLT-005). Every signed-in user may read the holidays the business
 * clock skips; only administrators see pending changes, draft them and decide them, and
 * CalendarService enforces maker-checker, future days only and one pending change per date.
 */
@ApiTags("calendar")
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get("holidays")
  @Roles(...ALL_ROLES)
  holidays(): Promise<HolidayView[]> {
    return this.calendar.holidays();
  }

  @Get()
  @Roles(Role.Admin)
  view(@CurrentUser() user: SessionUser): Promise<BusinessCalendarView> {
    return this.calendar.view(user);
  }

  @Post("changes")
  @Roles(Role.Admin)
  requestChange(
    @CurrentUser() user: SessionUser,
    @Body() body: HolidayChangeDto,
  ): Promise<BusinessCalendarView> {
    return this.calendar.requestChange(user, body);
  }

  @Post("changes/:id/approve")
  @HttpCode(200)
  @Roles(Role.Admin)
  approve(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideHolidayChangeDto,
  ): Promise<BusinessCalendarView> {
    return this.calendar.approve(user, id, body.note);
  }

  @Post("changes/:id/reject")
  @HttpCode(200)
  @Roles(Role.Admin)
  reject(
    @CurrentUser() user: SessionUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideHolidayChangeDto,
  ): Promise<BusinessCalendarView> {
    return this.calendar.reject(user, id, body.note);
  }
}

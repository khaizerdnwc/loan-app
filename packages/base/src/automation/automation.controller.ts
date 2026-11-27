import type { AutomationChangeRequest, AutomationEventView, AutomationView } from "@loan/core";
import { Role } from "@loan/core";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { AutomationChangeDto, DecideAutomationChangeDto, KillSwitchDto } from "./automation.dto";
import { AutomationService } from "./automation.service";

/** Who may look at the automation controls: administrators, and compliance (read-only). */
const READERS = [Role.Admin, Role.Compliance];

/**
 * Automation controls per product (PRD §7.5). Roles are the first gate; AutomationService
 * enforces maker-checker, one pending change per product and the state of the switch, so a
 * call that skips the UI meets the same rules.
 */
@ApiTags("automation")
@Controller("automation")
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @Roles(...READERS)
  list(@CurrentUser() user: SessionUser): Promise<AutomationView[]> {
    return this.automation.list(user);
  }

  @Get(":product/history")
  @Roles(...READERS)
  history(@Param("product") product: string): Promise<AutomationEventView[]> {
    return this.automation.history(product);
  }

  @Post(":product/changes")
  @Roles(Role.Admin)
  requestChange(
    @CurrentUser() user: SessionUser,
    @Param("product") product: string,
    @Body() body: AutomationChangeDto,
  ): Promise<AutomationView[]> {
    return this.automation.requestChange(user, product, body as AutomationChangeRequest);
  }

  @Post(":product/changes/:id/approve")
  @HttpCode(200)
  @Roles(Role.Admin)
  approve(
    @CurrentUser() user: SessionUser,
    @Param("product") product: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideAutomationChangeDto,
  ): Promise<AutomationView[]> {
    return this.automation.approve(user, product, id, body.note);
  }

  @Post(":product/changes/:id/reject")
  @HttpCode(200)
  @Roles(Role.Admin)
  reject(
    @CurrentUser() user: SessionUser,
    @Param("product") product: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideAutomationChangeDto,
  ): Promise<AutomationView[]> {
    return this.automation.reject(user, product, id, body.note);
  }

  @Post(":product/kill-switch")
  @HttpCode(200)
  @Roles(Role.Admin)
  killSwitchOn(
    @CurrentUser() user: SessionUser,
    @Param("product") product: string,
    @Body() body: KillSwitchDto,
  ): Promise<AutomationView[]> {
    return this.automation.killSwitchOn(user, product, body.reason);
  }
}

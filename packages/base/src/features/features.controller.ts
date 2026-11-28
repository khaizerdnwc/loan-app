import type { FeatureFlagView, FeatureStateView } from "@loan/core";
import { Role } from "@loan/core";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { DecideFeatureFlagChangeDto, FeatureFlagChangeDto } from "./features.dto";
import { FeaturesService } from "./features.service";

const ALL_ROLES = Object.values(Role);

/**
 * Feature flags (PRD PLT-006). Every signed-in user may read which modules are on, so the
 * backoffice can hide what is off; only administrators list, draft and decide changes, and
 * FeaturesService enforces maker-checker and one pending change per flag.
 */
@ApiTags("features")
@Controller("features")
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  @Roles(...ALL_ROLES)
  state(): Promise<FeatureStateView> {
    return this.features.state();
  }

  @Get("flags")
  @Roles(Role.Admin)
  list(@CurrentUser() user: SessionUser): Promise<FeatureFlagView[]> {
    return this.features.list(user);
  }

  @Post("flags/:key/changes")
  @Roles(Role.Admin)
  requestChange(
    @CurrentUser() user: SessionUser,
    @Param("key") key: string,
    @Body() body: FeatureFlagChangeDto,
  ): Promise<FeatureFlagView[]> {
    return this.features.requestChange(user, key, body);
  }

  @Post("flags/:key/changes/:id/approve")
  @HttpCode(200)
  @Roles(Role.Admin)
  approve(
    @CurrentUser() user: SessionUser,
    @Param("key") key: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideFeatureFlagChangeDto,
  ): Promise<FeatureFlagView[]> {
    return this.features.approve(user, key, id, body.note);
  }

  @Post("flags/:key/changes/:id/reject")
  @HttpCode(200)
  @Roles(Role.Admin)
  reject(
    @CurrentUser() user: SessionUser,
    @Param("key") key: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: DecideFeatureFlagChangeDto,
  ): Promise<FeatureFlagView[]> {
    return this.features.reject(user, key, id, body.note);
  }
}

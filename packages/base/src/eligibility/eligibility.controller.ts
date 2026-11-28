import { type EligibilityPreCheckView, Role } from "@loan/core";
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/auth.decorators";
import { EligibilityPreCheckDto } from "./eligibility.dto";
import { EligibilityService } from "./eligibility.service";

/**
 * The eligibility pre-check (PRD PC-008) for the loan officer at the counter, before an
 * application exists. A POST so stated figures stay out of URLs and logs; it changes nothing.
 */
@ApiTags("eligibility")
@Controller("eligibility")
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Post("pre-check")
  @HttpCode(200)
  @Roles(Role.LoanOfficer)
  preCheck(@Body() body: EligibilityPreCheckDto): Promise<EligibilityPreCheckView> {
    return this.eligibility.preCheck(body);
  }
}

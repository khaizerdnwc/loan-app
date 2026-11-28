import {
  type ApplicantView,
  type CaseDetail,
  type CoreCustomerView,
  type LoanOfficerView,
  Role,
} from "@loan/core";
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { ApplicantsService } from "./applicants.service";
import { NewApplicantDto, ReassignDto, SetPriorityDto } from "./dto";
import { RoutingService } from "./routing.service";

/**
 * The loan officers' intake and queue (PRD INT-005, INT-002, WF-002): capture a new applicant
 * (walk-in, or pre-filled from simulated core), pick, reassign and prioritise cases. Only the
 * loan officer acts here; the services check the case again under its lock.
 */
@ApiTags("cases")
@Controller()
export class RoutingController {
  constructor(
    private readonly routing: RoutingService,
    private readonly applicants: ApplicantsService,
  ) {}

  @Get("loan-officers")
  @Roles(Role.LoanOfficer)
  loanOfficers(@CurrentUser() user: SessionUser): Promise<LoanOfficerView[]> {
    return this.routing.loanOfficers(user);
  }

  @Post("cases/:id/pick")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  pick(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.routing.pick(user, id);
  }

  @Post("cases/:id/reassign")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  reassign(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReassignDto,
  ): Promise<CaseDetail> {
    return this.routing.reassign(user, id, body);
  }

  @Post("cases/:id/priority")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  setPriority(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetPriorityDto,
  ): Promise<CaseDetail> {
    return this.routing.setPriority(user, id, body);
  }

  /** Pre-fill from simulated core banking's customer file (labelled simulated). */
  @Get("customers/:customerNumber")
  @Roles(Role.LoanOfficer)
  customer(
    @CurrentUser() user: SessionUser,
    @Param("customerNumber") customerNumber: string,
  ): Promise<CoreCustomerView> {
    return this.applicants.lookup(user, customerNumber.slice(0, 20));
  }

  @Post("applicants")
  @Roles(Role.LoanOfficer)
  createApplicant(
    @CurrentUser() user: SessionUser,
    @Body() body: NewApplicantDto,
  ): Promise<ApplicantView> {
    return this.applicants.create(user, body);
  }
}

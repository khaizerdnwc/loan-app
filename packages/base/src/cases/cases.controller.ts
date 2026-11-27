import {
  type ActivityView,
  type ApplicantView,
  type CaseDetail,
  type CaseList,
  type DecisionRecordView,
  type IndicativeRepaymentView,
  type LoanAccountView,
  type ProductView,
  type ReproduceResult,
  Role,
} from "@loan/core";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { BookingService } from "./booking.service";
import { CaseViews } from "./case-views";
import { CasesRepository } from "./cases.repository";
import { CasesService } from "./cases.service";
import { ageOn, DecisionService } from "./decision.service";
import { notFound, validation } from "./domain-error";
import {
  CreateCaseDto,
  DeclineDto,
  IndicativeQuoteQueryDto,
  RecommendDto,
  UpdateDraftDto,
  WithdrawDto,
} from "./dto";
import { parseRequestAmount, productView, termErrors } from "./product";

const CASE_READERS = [
  Role.LoanOfficer,
  Role.Approver,
  Role.LoanOperations,
  Role.LoanOperationsSupervisor,
  Role.Compliance,
];
const OPERATIONS = [Role.LoanOperations, Role.LoanOperationsSupervisor];

/**
 * Roles here are the first gate (who may call at all). The services enforce the rest:
 * visibility of the case (404 outside it), the transition table, maker-checker and
 * authority — so a call that skips the UI meets the same rules.
 */
@ApiTags("cases")
@Controller()
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly booking: BookingService,
    private readonly decisions: DecisionService,
    private readonly repo: CasesRepository,
    private readonly views: CaseViews,
  ) {}

  @Get("products/PL")
  @Roles(...Object.values(Role))
  product(): ProductView {
    return productView();
  }

  /**
   * The indicative monthly repayment for terms being captured (PRD INT-004): core banking's
   * quote at INDICATIVE_GRADE pricing. 400 for terms outside the product; when core cannot
   * answer, 200 with status UNAVAILABLE, so the form never breaks on it. Writes nothing.
   */
  @Get("products/PL/quote")
  @Roles(Role.LoanOfficer)
  quote(@Query() query: IndicativeQuoteQueryDto): Promise<IndicativeRepaymentView> {
    const amount = parseRequestAmount(query.amount);
    const errors = termErrors(amount, query.tenorMonths);
    if (errors.length || !amount) throw validation("Check the highlighted fields.", errors);
    return this.views.indicativeRepayment(amount, query.tenorMonths);
  }

  @Get("applicants")
  @Roles(Role.LoanOfficer)
  async applicants(): Promise<ApplicantView[]> {
    const today = new Date().toISOString().slice(0, 10);
    return (await this.repo.listApplicants()).map((a) => ({
      id: a.id,
      fullName: a.fullName,
      birthDate: a.birthDate,
      ageYears: ageOn(a.birthDate, today),
      employer: a.employer,
      employmentMonths: a.employmentMonths,
      relationshipMonths: a.relationshipMonths,
      monthlyIncome: a.monthlyIncome.toString(),
      monthlyObligations: a.monthlyObligations.toString(),
      depositAccount: a.depositAccount,
      governmentIdMasked: `•••• •••• ${a.governmentIdLast4}`,
    }));
  }

  @Get("cases")
  @Roles(...CASE_READERS)
  list(@CurrentUser() user: SessionUser, @Query("view") view?: string): Promise<CaseList> {
    return this.cases.list(user, view === "all" ? "all" : "queue");
  }

  @Post("cases")
  @Roles(Role.LoanOfficer)
  create(@CurrentUser() user: SessionUser, @Body() body: CreateCaseDto): Promise<CaseDetail> {
    return this.cases.create(user, body);
  }

  @Get("cases/:id")
  @Roles(...CASE_READERS)
  get(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.get(user, id);
  }

  @Patch("cases/:id")
  @Roles(Role.LoanOfficer)
  update(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateDraftDto,
  ): Promise<CaseDetail> {
    return this.cases.updateDraft(user, id, body);
  }

  @Post("cases/:id/submit")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  submit(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.submit(user, id);
  }

  @Post("cases/:id/redecide")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  redecide(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.redecide(user, id);
  }

  @Get("cases/:id/activity")
  @Roles(...CASE_READERS)
  async activity(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ActivityView[]> {
    const c = await this.cases.visible(user, id);
    return this.views.activity(await this.repo.activity(c.id));
  }

  @Get("cases/:id/decision")
  @Roles(...CASE_READERS)
  async decision(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<DecisionRecordView> {
    const c = await this.cases.visible(user, id);
    const record = c.decisionId ? await this.repo.findDecision(c.decisionId) : null;
    if (!record) throw notFound("decision");
    return this.views.decision(record);
  }

  @Post("decisions/:id/reproduce")
  @Roles(Role.LoanOfficer, Role.Approver, Role.Compliance)
  @HttpCode(200)
  async reproduce(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReproduceResult> {
    const record = await this.repo.findDecision(id);
    if (!record) throw notFound("decision");
    await this.cases.visible(user, record.caseId);
    return this.decisions.reproduce(record);
  }

  @Post("cases/:id/recommendation")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  recommend(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RecommendDto,
  ): Promise<CaseDetail> {
    return this.cases.recommend(user, id, body);
  }

  @Post("cases/:id/approve")
  @Roles(Role.Approver)
  @HttpCode(200)
  approve(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.approve(user, id);
  }

  @Post("cases/:id/decline")
  @Roles(Role.Approver)
  @HttpCode(200)
  decline(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DeclineDto,
  ): Promise<CaseDetail> {
    return this.cases.decline(user, id, body);
  }

  @Post("cases/:id/return")
  @Roles(Role.Approver)
  @HttpCode(200)
  returnToReview(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.returnToReview(user, id);
  }

  @Post("cases/:id/withdraw")
  @Roles(Role.LoanOfficer)
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: WithdrawDto,
  ): Promise<CaseDetail> {
    return this.cases.withdraw(user, id, body);
  }

  @Post("cases/:id/sign")
  @Roles(...OPERATIONS)
  @HttpCode(200)
  sign(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.cases.sign(user, id);
  }

  @Post("cases/:id/booking")
  @Roles(...OPERATIONS)
  @HttpCode(200)
  submitBooking(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.booking.submit(user, id);
  }

  @Post("cases/:id/booking/approve")
  @Roles(Role.LoanOperationsSupervisor)
  @HttpCode(200)
  approveBooking(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<CaseDetail> {
    return this.booking.approve(user, id);
  }

  @Get("cases/:id/loan-account")
  @Roles(...CASE_READERS)
  async loanAccount(
    @CurrentUser() user: SessionUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<LoanAccountView> {
    const c = await this.cases.visible(user, id);
    const view = await this.views.loanAccount(c.id);
    if (!view) throw notFound("loan account");
    return view;
  }
}

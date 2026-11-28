import {
  type BookingExceptionView,
  type LatestReconciliationView,
  type ReconciliationRunSummaryView,
  type ReconciliationRunView,
  Role,
} from "@loan/core";
import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.decorators";
import type { SessionUser } from "../auth/session";
import { OperationsService } from "./operations.service";

const OPERATIONS = [Role.LoanOperations, Role.LoanOperationsSupervisor];
/** Compliance reads the exceptions and the reconciliation, but does not run it. */
const READERS = [...OPERATIONS, Role.Compliance];

/**
 * Booking exceptions and reconciliation (PRD BKG-005). Reading is for loan operations and
 * Compliance; running a reconciliation (which records a run, and changes nothing else) is
 * for loan operations.
 */
@ApiTags("operations")
@Controller("operations")
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("exceptions")
  @Roles(...READERS)
  exceptions(): Promise<BookingExceptionView[]> {
    return this.operations.exceptions();
  }

  @Post("reconciliation/runs")
  @Roles(...OPERATIONS)
  @HttpCode(201)
  run(@CurrentUser() user: SessionUser): Promise<ReconciliationRunView> {
    return this.operations.run(user);
  }

  /** The latest run with its findings (`run` is null before the first run). */
  @Get("reconciliation/latest")
  @Roles(...READERS)
  async latest(): Promise<LatestReconciliationView> {
    return { run: await this.operations.latest() };
  }

  @Get("reconciliation/runs")
  @Roles(...READERS)
  history(): Promise<ReconciliationRunSummaryView[]> {
    return this.operations.history();
  }
}

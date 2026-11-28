import { randomUUID } from "node:crypto";
import {
  type CoreCustomer,
  CUSTOMER_LOOKUP,
  type CustomerLookup,
  isProviderUnavailable,
} from "@loan/contracts";
import {
  type ApplicantView,
  type CoreCustomerView,
  type FieldError,
  type Money,
  type NewApplicantRequest,
  ProblemCode,
  Role,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { SessionUser } from "../auth/session";
import { TransactionRunner } from "../database/transaction-runner";
import { WALK_IN_ID_PREFIX } from "./applicant-source";
import { CasesRepository } from "./cases.repository";
import { ageOn } from "./decision.service";
import {
  DomainError,
  forbiddenRole,
  isUniqueViolation,
  notFound,
  validation,
} from "./domain-error";
import { ApplicantEntity } from "./entities/applicant.entity";
import { businessDate, parseRequestAmount } from "./product";

/** The partial unique index that keeps one applicant per core customer. */
export const CUSTOMER_NUMBER_INDEX = "UQ_applicant_customer_number";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Staff-assisted capture of a new applicant (PRD INT-005): a walk-in new to the bank, typed in
 * by the loan officer, or an existing WhiteBank customer found in simulated core banking
 * (PRD INT-002), whose identity, deposit account and relationship are taken from core — not
 * from the request. Core being down never blocks the manual capture of a new customer.
 * One applicant per core customer is kept by a partial unique index; its violation is mapped
 * to 409 after the transaction fails (no pre-check, so the index is the one path).
 */
@Injectable()
export class ApplicantsService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: CasesRepository,
    private readonly audit: AuditService,
    @Inject(CUSTOMER_LOOKUP) private readonly core: CustomerLookup,
  ) {}

  /** Pre-fill: the customer as core knows them, and the applicant already on file, if any. */
  async lookup(user: SessionUser, customerNumber: string): Promise<CoreCustomerView> {
    this.officerOnly(user);
    const customer = await this.findInCore(customerNumber);
    if (!customer) throw notFound("customer in core banking");
    const onFile = await this.repo.findApplicantByCustomerNumber(customer.customerNumber);
    return {
      customerNumber: customer.customerNumber,
      fullName: customer.fullName,
      birthDate: customer.birthDate,
      governmentIdLast4: customer.governmentIdLast4,
      employer: customer.employer,
      employmentMonths: customer.employmentMonths,
      monthlyIncome: customer.monthlyIncome.toString(),
      monthlyObligations: customer.monthlyObligations.toString(),
      relationshipMonths: customer.relationshipMonths,
      depositAccount: customer.depositAccount,
      providerMode: customer.mode,
      applicantId: onFile?.id ?? null,
    };
  }

  async create(user: SessionUser, body: NewApplicantRequest): Promise<ApplicantView> {
    this.officerOnly(user);
    const income = parseRequestAmount(body.monthlyIncome);
    const obligations = parseRequestAmount(body.monthlyObligations);
    const errors = fieldErrors(body, income, obligations);
    if (errors.length || !income || !obligations) {
      throw validation("Check the highlighted fields.", errors);
    }

    const a = new ApplicantEntity();
    a.id = `${WALK_IN_ID_PREFIX}${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    a.employer = body.employer.trim();
    a.employmentMonths = body.employmentMonths;
    a.monthlyObligations = obligations;
    a.relatedParty = false;
    if (body.customerNumber?.trim()) {
      const customer = await this.findInCore(body.customerNumber);
      if (!customer) {
        throw validation("Check the customer number.", [
          { field: "customerNumber", message: "Core banking has no customer with this number." },
        ]);
      }
      // Identity, account and relationship come from core; the officer's figure is what the
      // applicant declared, compared with the salary credits core sees (RS-PL-2 income check).
      a.customerNumber = customer.customerNumber;
      a.fullName = customer.fullName;
      a.birthDate = customer.birthDate;
      a.governmentIdLast4 = customer.governmentIdLast4;
      a.relationshipMonths = customer.relationshipMonths;
      a.depositAccount = customer.depositAccount;
      a.monthlyIncome = customer.monthlyIncome;
      a.declaredMonthlyIncome = income;
    } else {
      // New to the bank: nothing to verify against, so the declared income stands alone.
      a.customerNumber = null;
      a.fullName = body.fullName.trim();
      a.birthDate = body.birthDate;
      a.governmentIdLast4 = body.governmentIdLast4;
      a.relationshipMonths = 0;
      // New to the bank: no WhiteBank account yet, and none is taken from staff input — an
      // account is only ever core's (the pre-booking checklist relies on it).
      a.depositAccount = "";
      a.monthlyIncome = income;
      a.declaredMonthlyIncome = null;
    }

    try {
      await this.tx.run(async (m) => {
        await this.repo.insertApplicant(m, a);
        await this.audit.append(m, {
          actor: user,
          action: "APPLICANT_CAPTURED",
          summary: a.customerNumber
            ? `Captured applicant ${a.id} from core customer ${a.customerNumber} (simulated lookup).`
            : `Captured applicant ${a.id}, new to the bank (walk-in).`,
          details: { applicantId: a.id, customerNumber: a.customerNumber },
        });
      });
    } catch (err) {
      if (!isUniqueViolation(err, CUSTOMER_NUMBER_INDEX)) throw err;
      const existing = a.customerNumber
        ? await this.repo.findApplicantByCustomerNumber(a.customerNumber)
        : null;
      throw new DomainError(
        409,
        ProblemCode.DuplicateApplication,
        `This customer is already on file as applicant ${existing?.id ?? "(another applicant)"}. Choose them from the list instead.`,
      );
    }
    return {
      id: a.id,
      fullName: a.fullName,
      birthDate: a.birthDate,
      ageYears: ageOn(a.birthDate, businessDate()),
      employer: a.employer,
      employmentMonths: a.employmentMonths,
      relationshipMonths: a.relationshipMonths,
      monthlyIncome: a.monthlyIncome.toString(),
      monthlyObligations: a.monthlyObligations.toString(),
      depositAccount: a.depositAccount,
      governmentIdMasked: `•••• •••• ${a.governmentIdLast4}`,
    };
  }

  private async findInCore(customerNumber: string): Promise<CoreCustomer | null> {
    try {
      return await this.core.find(customerNumber.trim().toUpperCase());
    } catch (err) {
      if (!isProviderUnavailable(err)) throw err;
      throw new DomainError(
        503,
        ProblemCode.ProviderUnavailable,
        "Core banking's customer file is not answering. Capture the applicant by hand as a new customer, or try again.",
      );
    }
  }

  private officerOnly(user: SessionUser): void {
    if (user.role !== Role.LoanOfficer) {
      throw forbiddenRole("Only a loan officer captures applicants.");
    }
  }
}

function fieldErrors(
  body: NewApplicantRequest,
  income: Money | null,
  obligations: Money | null,
): FieldError[] {
  const errors: FieldError[] = [];
  const fromCore = Boolean(body.customerNumber?.trim());
  if (!fromCore) {
    const name = body.fullName?.trim() ?? "";
    if (name.length < 2 || name.length > 120) {
      errors.push({ field: "fullName", message: "Enter the applicant's full name." });
    }
    if (!ISO_DATE.test(body.birthDate ?? "") || Number.isNaN(Date.parse(body.birthDate))) {
      errors.push({ field: "birthDate", message: "Enter the birth date as YYYY-MM-DD." });
    } else if (body.birthDate >= businessDate()) {
      errors.push({ field: "birthDate", message: "The birth date must be in the past." });
    }
    if (!/^\d{4}$/.test(body.governmentIdLast4 ?? "")) {
      errors.push({
        field: "governmentIdLast4",
        message: "Enter the last 4 digits of the government ID.",
      });
    }
  }
  if (!body.employer?.trim()) errors.push({ field: "employer", message: "Enter the employer." });
  if (!income || income.isNegative()) {
    errors.push({ field: "monthlyIncome", message: "Enter the monthly income in pesos." });
  }
  if (!obligations || obligations.isNegative()) {
    errors.push({
      field: "monthlyObligations",
      message: "Enter the monthly obligations in pesos.",
    });
  }
  return errors;
}

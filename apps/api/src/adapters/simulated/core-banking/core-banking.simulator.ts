import {
  type BookingRequest,
  type CoreAccountRecord,
  type CoreBanking,
  type CoreLoanAccount,
  type LoanTerms,
  ProviderUnavailableError,
  type Quote,
} from "@loan/contracts";
import { Money, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "../failure";
import { SimulationModesService } from "../simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "../simulation-options";
import { buildSchedule, quote } from "./schedule";

/** How an account is stored in `sim.core_account.payload`: amounts as decimal strings. */
interface StoredAccount {
  accountNumber: string;
  principal: string;
  interest: string;
  totalRepayable: string;
  openedAt: string;
  schedule: {
    number: number;
    dueDate: string;
    principal: string;
    interest: string;
    amount: string;
  }[];
}

/**
 * A simulated WhiteBank core banking system. It owns the schedule maths (schedule.ts,
 * ADR 0019) and is idempotent on the booking key (ADR 0020 R4): an account is stored in
 * `sim.core_account` keyed by the idempotency key, in the simulator's own statement — not
 * in lending's transaction — so a replay returns the same account and schedule.
 *
 * LOST_REPLY mode creates the account and then fails as a timeout would: the case the
 * retry must handle without opening a second account.
 */
@Injectable()
export class SimulatedCoreBanking implements CoreBanking {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  /**
   * A quote opens nothing, so it has no state to keep: it follows the failure mode like any
   * call (OUTAGE, TIMEOUT, MALFORMED), and LOST_REPLY loses the reply as a timeout would.
   */
  async quote(terms: LoanTerms): Promise<Quote> {
    const mode = await applyFailureMode(ServiceName.CoreBanking, this.modes, this.options);
    if (mode === "LOST_REPLY") {
      throw new ProviderUnavailableError(
        ServiceName.CoreBanking,
        "TIMEOUT",
        "Core banking did not answer in time (simulated: the quote reply was lost)",
      );
    }
    const reply: Quote = { mode: ProviderMode.Simulated, ...quote(terms) };
    if (mode === "MALFORMED") (reply as Partial<Quote>).regularInstalment = undefined;
    return requireFields<Quote>(ServiceName.CoreBanking, reply, [
      "mode",
      "regularInstalment",
      "finalInstalment",
      "totalRepayable",
    ]);
  }

  async bookLoan(request: BookingRequest): Promise<CoreLoanAccount> {
    const mode = await applyFailureMode(ServiceName.CoreBanking, this.modes, this.options);

    const existing = await this.find(request.idempotencyKey);
    const stored = existing ?? (await this.open(request));

    if (mode === "LOST_REPLY") {
      throw new ProviderUnavailableError(
        ServiceName.CoreBanking,
        "TIMEOUT",
        "Core banking did not answer in time (simulated: the account was created, the reply was lost)",
      );
    }
    const reply = toAccount(request.idempotencyKey, stored);
    if (mode === "MALFORMED") (reply as Partial<CoreLoanAccount>).accountNumber = undefined;
    return requireFields<CoreLoanAccount>(ServiceName.CoreBanking, reply, [
      "accountNumber",
      "principal",
      "schedule",
    ]);
  }

  /** The simulated account feed: every account, oldest first, labelled simulated. */
  async listAccounts(): Promise<CoreAccountRecord[]> {
    const mode = await applyFailureMode(ServiceName.CoreBanking, this.modes, this.options);
    if (mode === "LOST_REPLY") {
      throw new ProviderUnavailableError(
        ServiceName.CoreBanking,
        "TIMEOUT",
        "Core banking did not answer in time (simulated: the account feed reply was lost)",
      );
    }
    const rows: {
      idempotency_key: string;
      application_id: string;
      payload: StoredAccount;
    }[] = await this.ds.query(
      "SELECT idempotency_key, application_id, payload FROM sim.core_account ORDER BY created_at, idempotency_key",
    );
    return rows.map((r) => {
      const record: Partial<CoreAccountRecord> = {
        mode: ProviderMode.Simulated,
        idempotencyKey: r.idempotency_key,
        accountNumber: r.payload.accountNumber,
        applicationId: r.application_id,
        principal: Money.of(r.payload.principal),
        openedAt: r.payload.openedAt,
      };
      if (mode === "MALFORMED") record.accountNumber = undefined;
      return requireFields<CoreAccountRecord>(ServiceName.CoreBanking, record, [
        "accountNumber",
        "principal",
      ]);
    });
  }

  private async find(key: string): Promise<StoredAccount | null> {
    const rows: { payload: StoredAccount }[] = await this.ds.query(
      "SELECT payload FROM sim.core_account WHERE idempotency_key = $1",
      [key],
    );
    return rows[0]?.payload ?? null;
  }

  private async open(request: BookingRequest): Promise<StoredAccount> {
    const q = quote(request.terms);
    const schedule = buildSchedule(request.terms, request.bookingDate);
    const [{ n }] = (await this.ds.query("SELECT nextval('sim.core_account_seq') AS n")) as [
      { n: string },
    ];
    const payload: StoredAccount = {
      accountNumber: `LN-${request.bookingDate.slice(0, 4)}-${n.padStart(6, "0")}`,
      principal: q.principal.toString(),
      interest: q.interest.toString(),
      totalRepayable: q.totalRepayable.toString(),
      openedAt: new Date().toISOString(),
      schedule: schedule.map((s) => ({
        number: s.number,
        dueDate: s.dueDate,
        principal: s.principal.toString(),
        interest: s.interest.toString(),
        amount: s.amount.toString(),
      })),
    };
    // A concurrent replay of the same key keeps the first account (ON CONFLICT DO NOTHING).
    await this.ds.query(
      `INSERT INTO sim.core_account (idempotency_key, account_number, application_id, payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [request.idempotencyKey, payload.accountNumber, request.applicationId, payload],
    );
    return (await this.find(request.idempotencyKey)) ?? payload;
  }
}

function toAccount(key: string, s: StoredAccount): CoreLoanAccount {
  return {
    provider: "Core banking (simulated)",
    mode: ProviderMode.Simulated,
    idempotencyKey: key,
    accountNumber: s.accountNumber,
    principal: Money.of(s.principal),
    interest: Money.of(s.interest),
    totalRepayable: Money.of(s.totalRepayable),
    openedAt: s.openedAt,
    schedule: s.schedule.map((l) => ({
      number: l.number,
      dueDate: l.dueDate,
      principal: Money.of(l.principal),
      interest: Money.of(l.interest),
      amount: Money.of(l.amount),
    })),
  };
}

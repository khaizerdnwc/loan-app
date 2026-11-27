import type {
  Disbursement,
  DisbursementReceipt,
  DisbursementRequest,
  PaymentRecord,
} from "@loan/contracts";
import { Money, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

interface StoredPayment {
  reference: string;
  amount: string;
  destinationAccount: string;
  loanAccountNumber: string;
  disbursedAt: string;
}

/**
 * A simulated payments rail. Idempotent on the booking key (ADR 0020 R6): a replay returns
 * the same payment reference, so a retried booking can never pay out twice.
 */
@Injectable()
export class SimulatedDisbursement implements Disbursement {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  /** The simulated payment feed: every payment, oldest first, labelled simulated. */
  async listPayments(): Promise<PaymentRecord[]> {
    const mode = await applyFailureMode(ServiceName.Disbursement, this.modes, this.options);
    const rows: { idempotency_key: string; payload: StoredPayment }[] = await this.ds.query(
      "SELECT idempotency_key, payload FROM sim.disbursement ORDER BY created_at, idempotency_key",
    );
    return rows.map((r) => {
      const record: Partial<PaymentRecord> = {
        mode: ProviderMode.Simulated,
        idempotencyKey: r.idempotency_key,
        reference: r.payload.reference,
        loanAccountNumber: r.payload.loanAccountNumber,
        amount: Money.of(r.payload.amount),
        disbursedAt: r.payload.disbursedAt,
      };
      if (mode === "MALFORMED") record.reference = undefined;
      return requireFields<PaymentRecord>(ServiceName.Disbursement, record, [
        "reference",
        "amount",
      ]);
    });
  }

  async disburse(request: DisbursementRequest): Promise<DisbursementReceipt> {
    const mode = await applyFailureMode(ServiceName.Disbursement, this.modes, this.options);
    const [{ n }] = (await this.ds.query("SELECT nextval('sim.disbursement_seq') AS n")) as [
      { n: string },
    ];
    const candidate: StoredPayment = {
      reference: `DSB-${n.padStart(8, "0")}`,
      amount: request.amount.toString(),
      destinationAccount: request.destinationAccount,
      loanAccountNumber: request.loanAccountNumber,
      disbursedAt: new Date().toISOString(),
    };
    await this.ds.query(
      `INSERT INTO sim.disbursement (idempotency_key, reference, payload) VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [request.idempotencyKey, candidate.reference, candidate],
    );
    const rows: { payload: StoredPayment }[] = await this.ds.query(
      "SELECT payload FROM sim.disbursement WHERE idempotency_key = $1",
      [request.idempotencyKey],
    );
    const stored = rows[0]?.payload ?? candidate;
    const reply: Partial<DisbursementReceipt> = {
      provider: "Disbursement (simulated)",
      mode: ProviderMode.Simulated,
      idempotencyKey: request.idempotencyKey,
      reference: stored.reference,
      amount: Money.of(stored.amount),
      destinationAccount: stored.destinationAccount,
      disbursedAt: stored.disbursedAt,
    };
    if (mode === "MALFORMED") reply.reference = undefined;
    return requireFields<DisbursementReceipt>(ServiceName.Disbursement, reply, [
      "reference",
      "amount",
      "destinationAccount",
    ]);
  }
}

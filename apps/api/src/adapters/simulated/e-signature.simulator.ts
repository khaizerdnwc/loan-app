import type { ESignature, SignatureRequest, SignatureResult } from "@loan/contracts";
import { ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

/**
 * Simulated e-signature. The borrower side is out of scope, so the envelope completes at
 * once. Idempotent on the key: a retry after a timeout returns the same envelope.
 */
@Injectable()
export class SimulatedESignature implements ESignature {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async sign(request: SignatureRequest): Promise<SignatureResult> {
    const mode = await applyFailureMode(ServiceName.ESignature, this.modes, this.options);
    const [{ n }] = (await this.ds.query("SELECT nextval('sim.envelope_seq') AS n")) as [
      { n: string },
    ];
    await this.ds.query(
      `INSERT INTO sim.signature (idempotency_key, envelope_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        request.idempotencyKey,
        `ENV-${n.padStart(8, "0")}`,
        {
          signerName: request.signerName,
          documentTitle: request.documentTitle,
          signedAt: new Date().toISOString(),
        },
      ],
    );
    const rows: { envelope_id: string; payload: { signedAt: string } }[] = await this.ds.query(
      "SELECT envelope_id, payload FROM sim.signature WHERE idempotency_key = $1",
      [request.idempotencyKey],
    );
    const row = rows[0];
    const reply: Partial<SignatureResult> = {
      provider: "E-signature (simulated)",
      mode: ProviderMode.Simulated,
      idempotencyKey: request.idempotencyKey,
      envelopeId: row?.envelope_id,
      signedAt: row?.payload.signedAt,
    };
    if (mode === "MALFORMED") reply.envelopeId = undefined;
    return requireFields<SignatureResult>(ServiceName.ESignature, reply, [
      "envelopeId",
      "signedAt",
    ]);
  }
}

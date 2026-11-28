import type { MessageReceipt, Notifications, OutboundMessage } from "@loan/contracts";
import { ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

/**
 * A simulated email and SMS gateway (PRD NTF-001): nothing is delivered to anyone. Each
 * accepted message is kept in `sim.notification`, in the simulator's own statement, keyed by
 * the idempotency key, so a retry after a timeout returns the same reference and never a
 * second message. Only the template and channel are kept; the words stay with lending.
 */
@Injectable()
export class SimulatedNotifications implements Notifications {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async send(message: OutboundMessage): Promise<MessageReceipt> {
    const mode = await applyFailureMode(ServiceName.Notifications, this.modes, this.options);
    const [{ n }] = (await this.ds.query("SELECT nextval('sim.notification_seq') AS n")) as [
      { n: string },
    ];
    await this.ds.query(
      `INSERT INTO sim.notification (idempotency_key, reference, channel, template, recipient_ref)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        message.idempotencyKey,
        `MSG-${n.padStart(8, "0")}`,
        message.channel,
        message.template,
        message.recipientRef,
      ],
    );
    const rows: { reference: string; channel: string; accepted_at: Date }[] = await this.ds.query(
      "SELECT reference, channel, accepted_at FROM sim.notification WHERE idempotency_key = $1",
      [message.idempotencyKey],
    );
    const row = rows[0];
    const reply: Partial<MessageReceipt> = {
      provider: "Email and SMS gateway (simulated)",
      mode: ProviderMode.Simulated,
      idempotencyKey: message.idempotencyKey,
      reference: row?.reference,
      channel: message.channel,
      acceptedAt: row ? new Date(row.accepted_at).toISOString() : undefined,
    };
    if (mode === "MALFORMED") reply.reference = undefined;
    return requireFields<MessageReceipt>(ServiceName.Notifications, reply, [
      "reference",
      "acceptedAt",
    ]);
  }
}

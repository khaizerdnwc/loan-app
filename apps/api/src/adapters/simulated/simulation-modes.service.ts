import type { ServiceModeChange, ServiceState, SimulationControl } from "@loan/contracts";
import {
  CoreBankingSimulationMode,
  type CoreBankingSimulationMode as CoreMode,
  ServiceName,
  SimulationMode,
} from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

const LABELS: Record<ServiceName, string> = {
  CREDIT_BUREAU: "Credit bureau (simulated)",
  KYC_AML: "KYC / AML screening (simulated)",
  CORE_BANKING: "Core banking (simulated)",
  DISBURSEMENT: "Disbursement (simulated)",
  E_SIGNATURE: "E-signature (simulated)",
  FRAUD: "Fraud signals (simulated)",
  DOCUMENT_INTAKE: "Document upload (simulated)",
  CUSTOMER_LOOKUP: "Core customer lookup (simulated)",
  NOTIFICATIONS: "Email and SMS gateway (simulated)",
  DOCUMENT_EXTRACTION: "OCR and statement analysis (simulated)",
};

const UNIVERSAL: CoreMode[] = Object.values(SimulationMode);
const CORE: CoreMode[] = Object.values(CoreBankingSimulationMode);

export function supportedModes(service: ServiceName): CoreMode[] {
  return service === ServiceName.CoreBanking ? CORE : UNIVERSAL;
}

interface ModeRow {
  service: ServiceName;
  mode: CoreMode;
  set_by: string | null;
  resets_at: Date | null;
}

/**
 * The failure switch for every simulated provider (Engineering Standard 9). Modes live in
 * the simulators' own schema (`sim.service_mode`), so they survive restarts and are shared
 * by every API instance. A non-OK mode carries `resets_at`: once past, the mode reads as OK,
 * so the shared demo can never be left broken.
 */
@Injectable()
export class SimulationModesService implements SimulationControl {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  /** The mode a service is in right now (expired modes read as OK). */
  async modeOf(service: ServiceName): Promise<CoreMode> {
    const rows: ModeRow[] = await this.ds.query(
      "SELECT service, mode, set_by, resets_at FROM sim.service_mode WHERE service = $1",
      [service],
    );
    const row = rows[0];
    if (!row || (row.resets_at && row.resets_at.getTime() <= Date.now())) return SimulationMode.Ok;
    return row.mode;
  }

  async list(): Promise<ServiceState[]> {
    const rows: ModeRow[] = await this.ds.query(
      "SELECT service, mode, set_by, resets_at FROM sim.service_mode ORDER BY service",
    );
    const byService = new Map(rows.map((r) => [r.service, r]));
    return Object.values(ServiceName).map((service) => {
      const row = byService.get(service);
      const expired = !row || (row.resets_at !== null && row.resets_at.getTime() <= Date.now());
      return {
        service,
        label: LABELS[service],
        mode: expired || !row ? SimulationMode.Ok : row.mode,
        supportedModes: supportedModes(service),
        resetsAt: expired || !row?.resets_at ? null : row.resets_at.toISOString(),
        setBy: expired || !row ? null : row.set_by,
      };
    });
  }

  async set(change: ServiceModeChange, setBy: string): Promise<ServiceState> {
    if (!supportedModes(change.service).includes(change.mode)) {
      throw new Error(`${change.service} does not support ${change.mode}`);
    }
    const resetsAt =
      change.mode === SimulationMode.Ok
        ? null
        : new Date(Date.now() + this.options.autoResetMinutes * 60_000);
    await this.ds.query(
      `INSERT INTO sim.service_mode (service, mode, set_by, resets_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (service) DO UPDATE SET mode = $2, set_by = $3, resets_at = $4`,
      [change.service, change.mode, setBy, resetsAt],
    );
    const state = (await this.list()).find((s) => s.service === change.service);
    if (!state) throw new Error(`unknown service ${change.service}`);
    return state;
  }

  async resetAll(): Promise<void> {
    await this.ds.query("DELETE FROM sim.service_mode");
  }
}

import type { CoreBankingSimulationMode, ServiceName, SimulationMode } from "@loan/core";

/**
 * A service and a mode it can actually be in, keyed on the service, so the type itself
 * refuses LOST_REPLY for anything but core banking.
 */
export type ServiceModeChange =
  | { service: "CORE_BANKING"; mode: CoreBankingSimulationMode }
  | { service: Exclude<ServiceName, "CORE_BANKING">; mode: SimulationMode };

export interface ServiceState {
  service: ServiceName;
  label: string;
  mode: CoreBankingSimulationMode;
  /** Modes this service supports (only core banking has LOST_REPLY). */
  supportedModes: CoreBankingSimulationMode[];
  /** ISO time the mode returns to OK, or null when already OK. */
  resetsAt: string | null;
  setBy: string | null;
}

/**
 * How the admin screen sees and switches the simulated providers' failure modes
 * (Engineering Standard 9). A non-OK mode resets itself to OK after a set time, so a
 * reviewer cannot leave the shared demo broken.
 */
export interface SimulationControl {
  list(): Promise<ServiceState[]>;
  set(change: ServiceModeChange, setBy: string): Promise<ServiceState>;
  resetAll(): Promise<void>;
}

export const SIMULATION_CONTROL = "SIMULATION_CONTROL_PORT";

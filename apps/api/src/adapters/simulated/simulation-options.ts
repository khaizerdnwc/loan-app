/** Timing for the simulated providers, from the environment (tests use short values). */
export interface SimulationOptions {
  /** Minutes after which a non-OK mode reads as OK again. */
  autoResetMinutes: number;
  /** How long a TIMEOUT mode waits before giving up, in milliseconds. */
  timeoutMs: number;
}

export const SIMULATION_OPTIONS = "SIMULATION_OPTIONS";

import { ProviderUnavailableError } from "@loan/contracts";
import { type ServiceName, SimulationMode } from "@loan/core";
import type { SimulationModesService } from "./simulation-modes.service";
import type { SimulationOptions } from "./simulation-options";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Apply a service's current failure mode before it answers. OUTAGE fails at once; TIMEOUT
 * waits the configured time and then fails, as a real client's timeout would. MALFORMED is
 * returned to the caller, which builds a broken reply and lets its own parser reject it,
 * so the "provider replied with nonsense" path runs the same validation a real one would.
 */
export async function applyFailureMode(
  service: ServiceName,
  modes: SimulationModesService,
  options: SimulationOptions,
): Promise<"OK" | "MALFORMED" | "LOST_REPLY"> {
  const mode = await modes.modeOf(service);
  if (mode === SimulationMode.Outage) {
    throw new ProviderUnavailableError(
      service,
      "OUTAGE",
      `${service} is unavailable (simulated outage)`,
    );
  }
  if (mode === SimulationMode.Timeout) {
    await sleep(options.timeoutMs);
    throw new ProviderUnavailableError(
      service,
      "TIMEOUT",
      `${service} did not answer within ${options.timeoutMs} ms (simulated timeout)`,
    );
  }
  if (mode === SimulationMode.Malformed) return "MALFORMED";
  if (mode === "LOST_REPLY") return "LOST_REPLY";
  return "OK";
}

/** Reject a reply that is missing a field it must carry — what a real adapter's parser does. */
export function requireFields<T extends object>(
  service: ServiceName,
  reply: Partial<T>,
  fields: (keyof T)[],
): T {
  for (const field of fields) {
    if (reply[field] === undefined || reply[field] === null) {
      throw new ProviderUnavailableError(
        service,
        "MALFORMED",
        `${service} replied without "${String(field)}" (simulated malformed reply)`,
      );
    }
  }
  return reply as T;
}

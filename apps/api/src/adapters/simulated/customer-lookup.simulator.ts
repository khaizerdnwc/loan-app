import type { CoreCustomer, CustomerLookup } from "@loan/contracts";
import { Money, ProviderMode, ServiceName } from "@loan/core";
import { Inject, Injectable } from "@nestjs/common";
import { applyFailureMode, requireFields } from "./failure";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS, type SimulationOptions } from "./simulation-options";

type SyntheticCustomer = Omit<
  CoreCustomer,
  "provider" | "mode" | "monthlyIncome" | "monthlyObligations"
> & {
  monthlyIncome: string;
  monthlyObligations: string;
};

/**
 * The simulated core's customer file: synthetic WhiteBank customers who are not yet loan
 * applicants, so a walk-in can be pre-filled from core (PRD INT-002). All data is invented.
 */
const SYNTHETIC_CUSTOMERS: readonly SyntheticCustomer[] = [
  {
    customerNumber: "CIF-100245",
    fullName: "Lorna Bautista",
    birthDate: "1990-03-17",
    governmentIdLast4: "5521",
    employer: "Makati Medical Supplies Inc.",
    employmentMonths: 52,
    monthlyIncome: "64000.00",
    monthlyObligations: "7500.00",
    relationshipMonths: 61,
    depositAccount: "WB-SAV-0245-1180",
  },
  {
    customerNumber: "CIF-100388",
    fullName: "Arnel Domingo",
    birthDate: "1986-11-02",
    governmentIdLast4: "3307",
    employer: "Cebu Port Logistics",
    employmentMonths: 96,
    monthlyIncome: "88000.00",
    monthlyObligations: "21000.00",
    relationshipMonths: 120,
    depositAccount: "WB-SAV-0388-2291",
  },
  {
    customerNumber: "CIF-100412",
    fullName: "Celeste Navarro",
    birthDate: "1997-07-25",
    governmentIdLast4: "8814",
    employer: "Quezon City Public Library",
    employmentMonths: 20,
    monthlyIncome: "38000.00",
    monthlyObligations: "3000.00",
    relationshipMonths: 14,
    depositAccount: "WB-SAV-0412-6045",
  },
];

/**
 * Simulated core banking customer lookup. Follows the service's failure mode like every
 * simulator: OUTAGE and TIMEOUT fail, MALFORMED returns a record without its customer number
 * (rejected by the parser). A read: nothing is stored.
 */
@Injectable()
export class SimulatedCustomerLookup implements CustomerLookup {
  constructor(
    private readonly modes: SimulationModesService,
    @Inject(SIMULATION_OPTIONS) private readonly options: SimulationOptions,
  ) {}

  async find(customerNumber: string): Promise<CoreCustomer | null> {
    const mode = await applyFailureMode(ServiceName.CustomerLookup, this.modes, this.options);
    const found = SYNTHETIC_CUSTOMERS.find(
      (c) => c.customerNumber === customerNumber.trim().toUpperCase(),
    );
    if (!found) return null;
    const reply: Partial<CoreCustomer> = {
      ...found,
      provider: "Core banking customer file (simulated)",
      mode: ProviderMode.Simulated,
      monthlyIncome: Money.of(found.monthlyIncome),
      monthlyObligations: Money.of(found.monthlyObligations),
    };
    if (mode === "MALFORMED") reply.customerNumber = undefined;
    return requireFields<CoreCustomer>(ServiceName.CustomerLookup, reply, [
      "customerNumber",
      "fullName",
      "birthDate",
      "depositAccount",
    ]);
  }
}

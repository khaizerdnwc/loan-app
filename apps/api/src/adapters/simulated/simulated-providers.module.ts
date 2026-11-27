import {
  CORE_BANKING,
  CREDIT_BUREAU,
  DISBURSEMENT,
  E_SIGNATURE,
  KYC_AML,
  SIMULATION_CONTROL,
} from "@loan/contracts";
import { Global, Module } from "@nestjs/common";
import { env } from "../../config/env";
import { SimulatedCoreBanking } from "./core-banking/core-banking.simulator";
import { SimulatedCreditBureau } from "./credit-bureau.simulator";
import { SimulatedDisbursement } from "./disbursement.simulator";
import { SimulatedESignature } from "./e-signature.simulator";
import { SimulatedKycAml } from "./kyc-aml.simulator";
import { SimulationModesService } from "./simulation-modes.service";
import { SIMULATION_OPTIONS } from "./simulation-options";

/**
 * Binds every port to its simulated provider. This module and app.module.ts are the only
 * places that name a concrete provider (house/no-provider-import-outside-adapters): a real
 * provider replaces one `useExisting` line here, not workflow or decision code.
 */
@Global()
@Module({
  providers: [
    {
      provide: SIMULATION_OPTIONS,
      useFactory: () => ({
        autoResetMinutes: env().SIMULATION_AUTO_RESET_MINUTES,
        timeoutMs: env().SIMULATION_TIMEOUT_MS,
      }),
    },
    SimulationModesService,
    SimulatedCreditBureau,
    SimulatedKycAml,
    SimulatedCoreBanking,
    SimulatedDisbursement,
    SimulatedESignature,
    { provide: CREDIT_BUREAU, useExisting: SimulatedCreditBureau },
    { provide: KYC_AML, useExisting: SimulatedKycAml },
    { provide: CORE_BANKING, useExisting: SimulatedCoreBanking },
    { provide: DISBURSEMENT, useExisting: SimulatedDisbursement },
    { provide: E_SIGNATURE, useExisting: SimulatedESignature },
    { provide: SIMULATION_CONTROL, useExisting: SimulationModesService },
  ],
  exports: [CREDIT_BUREAU, KYC_AML, CORE_BANKING, DISBURSEMENT, E_SIGNATURE, SIMULATION_CONTROL],
})
export class SimulatedProvidersModule {}

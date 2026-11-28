import {
  CORE_BANKING,
  CREDIT_BUREAU,
  CUSTOMER_LOOKUP,
  DISBURSEMENT,
  DOCUMENT_INTAKE,
  E_SIGNATURE,
  FRAUD_CHECK,
  KYC_AML,
  SIMULATION_CONTROL,
} from "@loan/contracts";
import { Global, Module } from "@nestjs/common";
import { env } from "../../config/env";
import { SimulatedCoreBanking } from "./core-banking/core-banking.simulator";
import { SimulatedCreditBureau } from "./credit-bureau.simulator";
import { SimulatedCustomerLookup } from "./customer-lookup.simulator";
import { SimulatedDisbursement } from "./disbursement.simulator";
import { SimulatedDocumentIntake } from "./document-intake.simulator";
import { SimulatedESignature } from "./e-signature.simulator";
import { SimulatedFraudCheck } from "./fraud-check.simulator";
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
    SimulatedFraudCheck,
    SimulatedDocumentIntake,
    SimulatedCustomerLookup,
    { provide: CREDIT_BUREAU, useExisting: SimulatedCreditBureau },
    { provide: KYC_AML, useExisting: SimulatedKycAml },
    { provide: CORE_BANKING, useExisting: SimulatedCoreBanking },
    { provide: DISBURSEMENT, useExisting: SimulatedDisbursement },
    { provide: E_SIGNATURE, useExisting: SimulatedESignature },
    { provide: FRAUD_CHECK, useExisting: SimulatedFraudCheck },
    { provide: DOCUMENT_INTAKE, useExisting: SimulatedDocumentIntake },
    { provide: CUSTOMER_LOOKUP, useExisting: SimulatedCustomerLookup },
    { provide: SIMULATION_CONTROL, useExisting: SimulationModesService },
  ],
  exports: [
    CREDIT_BUREAU,
    KYC_AML,
    CORE_BANKING,
    DISBURSEMENT,
    E_SIGNATURE,
    FRAUD_CHECK,
    DOCUMENT_INTAKE,
    CUSTOMER_LOOKUP,
    SIMULATION_CONTROL,
  ],
})
export class SimulatedProvidersModule {}

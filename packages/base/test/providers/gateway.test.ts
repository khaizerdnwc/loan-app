import type { CreditBureau, ExternalDecisionEngine, FraudCheck, KycAml } from "@loan/contracts";
import type { LendingModuleOptions } from "../../src/lending.options";
import { ProviderGateway } from "../../src/providers/provider-gateway.service";
import type { ProvidersRepository } from "../../src/providers/providers.repository";

/**
 * PR-2: a pulled report is cached under the gateway's own provider mode, the one the lookup
 * filters on and the decision record states, whatever mode the reply claims.
 */
it("caches a bureau report under the gateway's mode, not the mode the reply names", async () => {
  const report = {
    provider: "Credit bureau (simulated)",
    mode: "SOMETHING_ELSE",
    fileDepth: "FULL",
    bureauScore: 748,
    tradeLines: 6,
    utilisationPct: 35,
    delinquencies12m: 0,
    existingDefault: false,
    monthsOnFile: 96,
    retrievedAt: "2026-11-28T01:00:00.000Z",
  };
  const port = { mode: "SIMULATED" };
  const bureau = { ...port, pull: jest.fn().mockResolvedValue(report) };
  const repo = {
    cachedReport: jest.fn().mockResolvedValue(null),
    cacheReport: jest.fn().mockResolvedValue(undefined),
    recordCall: jest.fn().mockResolvedValue(undefined),
  };
  const gateway = new ProviderGateway(
    bureau as unknown as CreditBureau,
    port as unknown as KycAml,
    port as unknown as FraudCheck,
    port as unknown as ExternalDecisionEngine,
    repo as unknown as ProvidersRepository,
    { jwtSecret: "x", cookieSecure: false } as LendingModuleOptions,
  );
  await gateway.pullBureau(
    { applicantId: "APL-X", fullName: "X", birthDate: "1990-01-01", governmentIdLast4: "0000" },
    null,
  );
  expect(repo.cachedReport).toHaveBeenCalledWith("APL-X", "SIMULATED", expect.any(Date));
  expect(repo.cacheReport).toHaveBeenCalledWith(
    expect.objectContaining({ applicantId: "APL-X", mode: "SIMULATED" }),
  );
});

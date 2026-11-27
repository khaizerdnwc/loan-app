import type { EntityManager } from "typeorm";
import type { AutomationService } from "../../src/automation/automation.service";
import type { CasesRepository } from "../../src/cases/cases.repository";
import { DecisionService } from "../../src/cases/decision.service";
import type { LoanCaseEntity } from "../../src/cases/entities/loan-case.entity";
import type { ProviderGateway } from "../../src/providers/provider-gateway.service";
import { MARIA_F1 } from "../decisioning/personas";

/**
 * AU-2: the automation mode is read with the manager of the decision's own transaction (so its
 * share lock is held until the record commits), and it is what the record and snapshot store.
 */
describe("DecisionService reads the automation mode inside the decision's transaction", () => {
  it("passes the transaction's manager to AutomationService.forDecision and records that mode", async () => {
    const forDecision = jest.fn().mockResolvedValue({ mode: "SHADOW", killSwitch: false });
    const insertDecision = jest.fn(async (_m: EntityManager, r: object) => ({ id: "d1", ...r }));
    const service = new DecisionService(
      { mode: "SIMULATED" } as unknown as ProviderGateway,
      { insertDecision } as unknown as CasesRepository,
      { forDecision } as unknown as AutomationService,
    );
    const manager = { tag: "the decision's transaction" } as unknown as EntityManager;
    const { automation: _a, ...gathered } = MARIA_F1;

    const { record, result } = await service.decideAndRecord(
      manager,
      { id: "c1", productCode: "PL" } as LoanCaseEntity,
      gathered,
      "STF-PAOLO",
    );

    expect(forDecision).toHaveBeenCalledWith(manager, "PL");
    expect(insertDecision).toHaveBeenCalledWith(manager, expect.anything());
    expect(result).toMatchObject({ outcome: "REFER", engineOutcome: "AUTO_APPROVE" });
    expect(record).toMatchObject({
      automationMode: "SHADOW",
      killSwitch: false,
      engineOutcome: "AUTO_APPROVE",
      inputs: { automation: { mode: "SHADOW", killSwitch: false } },
    });
  });
});

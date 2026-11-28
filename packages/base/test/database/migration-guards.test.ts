import type { QueryRunner } from "typeorm";
import { AutomationAndTriggers1764300003000 } from "../../src/database/migrations/1764300003000-AutomationAndTriggers";
import { ProviderResilienceAndEstimates1764300003001 } from "../../src/database/migrations/1764300003001-ProviderResilienceAndEstimates";
import { ExternalDecisionEngine1764300003002 } from "../../src/database/migrations/1764300003002-ExternalDecisionEngine";

/**
 * Forward-only once used (ADR 0022 amendments): reverting 3000 or 3001 on a database that holds
 * the data they added would drop it (and, for 3000, leave RS-PL-2 records that fail the CHECK
 * on the way back up). Each down() counts that data first and refuses, touching nothing.
 */
function runner(counts: Record<string, number>) {
  const statements: string[] = [];
  const q = {
    query: jest.fn(async (sql: string) => {
      statements.push(sql);
      return /count\(\*\)/.test(sql) ? [counts] : [];
    }),
  } as unknown as QueryRunner;
  return { q, statements };
}

describe("migration 1764300003000 (automation, RS-PL-2 inputs): down() is forward-only once used", () => {
  it.each([[{ records: 1, events: 0 }], [{ records: 0, events: 3 }]])(
    "refuses with %j and drops nothing",
    async (counts) => {
      const { q, statements } = runner(counts);
      await expect(new AutomationAndTriggers1764300003000().down(q)).rejects.toThrow(
        /Cannot revert AutomationAndTriggers/,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/rule_set_version" <> 'RS-PL-1'/);
    },
  );

  it("reverts a database with no such data", async () => {
    const { q, statements } = runner({ records: 0, events: 0 });
    await new AutomationAndTriggers1764300003000().down(q);
    expect(statements.some((s) => /DROP TABLE "product_automation"/.test(s))).toBe(true);
  });
});

describe("migration 1764300003001 (estimates, provider calls): down() is forward-only once used", () => {
  it.each([[{ records: 2, calls: 0 }], [{ records: 0, calls: 9 }]])(
    "refuses with %j and drops nothing",
    async (counts) => {
      const { q, statements } = runner(counts);
      await expect(new ProviderResilienceAndEstimates1764300003001().down(q)).rejects.toThrow(
        /Cannot revert ProviderResilienceAndEstimates/,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/"rule_set_version" NOT IN \('RS-PL-1', 'RS-PL-2'\)/);
      expect(statements[0]).toMatch(/"pd" IS NOT NULL OR "recommended_amount" IS NOT NULL/);
    },
  );

  it("reverts a database with no such data", async () => {
    const { q, statements } = runner({ records: 0, calls: 0 });
    await new ProviderResilienceAndEstimates1764300003001().down(q);
    expect(statements.some((s) => /DROP TABLE "provider_call"/.test(s))).toBe(true);
  });
});

describe("migration 1764300003002 (external decision engine): down() is forward-only once used", () => {
  it.each([
    [{ records: 1, changes: 0, products: 0 }],
    [{ records: 0, changes: 2, products: 0 }],
    [{ records: 0, changes: 0, products: 1 }],
  ])("refuses with %j and drops nothing", async (counts) => {
    const { q, statements } = runner(counts);
    await expect(new ExternalDecisionEngine1764300003002().down(q)).rejects.toThrow(
      /Cannot revert ExternalDecisionEngine/,
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/"rule_set_version" = 'RS-PL-4'/);
  });

  it("reverts a database with no such data", async () => {
    const { q, statements } = runner({ records: 0, changes: 0, products: 0 });
    await new ExternalDecisionEngine1764300003002().down(q);
    expect(statements.some((s) => /DROP COLUMN "external_engine"/.test(s))).toBe(true);
  });
});

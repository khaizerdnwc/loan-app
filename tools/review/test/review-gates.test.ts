import { describe, expect, it } from "vitest";
// commitlint.config.js lives at the workspace root; its rule is a plain function.
import { fixNeedsRepro } from "../../../commitlint.config.js";
import { baseRef, reviewRoles } from "../src/_review";
import {
  childEnv,
  isE2eSpec,
  isIntegrationTest,
  isRunnableTest,
  isTestSide,
  judge,
  parseArgs as parseReproArgs,
  type RunCounts,
} from "../src/repro-proof";
import { answeredIds, missingAnswers, stampProblems } from "../src/review-ack";

describe("reviewRoles — the /review path table as code", () => {
  it.each([
    ["packages/base/src/auth/roles.guard.ts", "security"],
    ["packages/base/src/approvals/approvals.controller.ts", "security"],
    ["packages/base/src/booking/dto/submit-booking.dto.ts", "security"],
    ["apps/api/src/main.ts", "security"],
    ["apps/api/src/config/env.ts", "security"],
    ["apps/backoffice/src/middleware.ts", "security"],
    ["apps/backoffice/src/lib/api/client.ts", "security"],
    ["apps/backoffice/src/app/cases/[id]/page.tsx", "ui-ux"],
    ["packages/ui/src/button.tsx", "ui-ux"],
    ["packages/base/src/booking/entities/loan-account.entity.ts", "data"],
    ["packages/base/src/database/migrations/1764000000000-init.ts", "data"],
    ["packages/base/src/booking/booking.repository.ts", "data"],
    ["packages/core/src/money/money.ts", "data"],
    ["packages/contracts/src/core-banking.port.ts", "architecture"],
    ["packages/base/src/booking/booking.module.ts", "architecture"],
    ["apps/api/src/adapters/simulated/core-banking.ts", "architecture"],
    ["apps/api/test/booking.e2e-spec.ts", "qa"],
    ["apps/backoffice/e2e/f1.spec.ts", "qa"],
    ["tools/review/test/x.test.ts", "qa"],
    ["docs/ACCEPTANCE.md", "qa"],
    [".github/workflows/verify.yml", "devops"],
    ["scripts/verify/verify.sh", "devops"],
    ["lefthook.yml", "devops"],
    ["apps/api/Dockerfile", "devops"],
    ["apps/api/.env.example", "devops"],
  ])("%s → %s", (file, role) => {
    expect([...reviewRoles([file]).keys()]).toContain(role);
  });

  it("sends any domain change to qa, and a new module folder to architecture", () => {
    const file = "packages/base/src/brand-new/util.ts";
    expect([...reviewRoles([file]).keys()]).toEqual(["qa"]);
    expect([...reviewRoles([file], ["packages/base/src/brand-new"]).keys()]).toEqual([
      "architecture",
      "qa",
    ]);
  });

  it("spawns nobody for docs", () => {
    expect(reviewRoles(["docs/AGENT-WORKFLOW.md"]).size).toBe(0);
  });
});

describe("review:ack — every lesson answered", () => {
  const report = [
    "Lessons",
    "- [data-20261123-created-at-ties] applies — checked: ORDER BY id tiebreak present",
    "- [data-20261004-external-value] not relevant — no third-party writes in this diff",
    "- [data-20260101-mentioned] is discussed but has no verdict",
  ].join("\n");

  it("reads only ids with a verdict", () => {
    expect([...answeredIds(report)]).toEqual([
      "data-20261123-created-at-ties",
      "data-20261004-external-value",
    ]);
  });

  it("names a missing report and each unanswered id", () => {
    const problems = missingAnswers(
      new Map([
        ["data", ["data-20261123-created-at-ties", "data-20260101-mentioned"]],
        ["qa", ["qa-20260101-x"]],
      ]),
      new Map([
        ["data", report],
        ["qa", null],
      ]),
    );
    expect(problems).toEqual([
      "data: no verdict for data-20260101-mentioned",
      "qa: no report saved at .claude/.review/qa.report.md",
    ]);
  });

  it("passes when every id is answered", () => {
    expect(
      missingAnswers(
        new Map([["data", ["data-20261123-created-at-ties"]]]),
        new Map([["data", report]]),
      ),
    ).toEqual([]);
  });
});

describe("repro proof — the rule", () => {
  const counts = (o: Partial<RunCounts>): RunCounts => ({
    code: 0,
    failedTests: 0,
    passedTests: 0,
    suiteErrors: 0,
    ...o,
  });

  it("holds when a test fails without the fix and all pass with it", () => {
    expect(
      judge(counts({ code: 1, failedTests: 1, passedTests: 2 }), counts({ passedTests: 3 })).ok,
    ).toBe(true);
  });

  it("fails when the test already passes without the fix", () => {
    const v = judge(counts({ passedTests: 3 }), counts({ passedTests: 3 }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/PASS without the fix/);
  });

  it("does not count a test that cannot load without the fix", () => {
    const v = judge(counts({ code: 1, suiteErrors: 1 }), counts({ passedTests: 1 }));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/did not load/);
  });

  it("fails when the fix does not make the test pass", () => {
    expect(judge(counts({ code: 1, failedTests: 1 }), counts({ code: 1, failedTests: 1 })).ok).toBe(
      false,
    );
  });

  it("fails when nothing ran with the fix (all skipped)", () => {
    expect(judge(counts({ code: 1, failedTests: 1 }), counts({})).ok).toBe(false);
  });

  it("tells tests from product code", () => {
    expect(isRunnableTest("packages/base/test/schedule.test.ts")).toBe(true);
    expect(isRunnableTest("apps/api/test/booking.e2e-spec.ts")).toBe(true);
    expect(isRunnableTest("tools/review/test/lessons.test.ts")).toBe(true);
    expect(isRunnableTest("apps/backoffice/e2e/f1.spec.ts")).toBe(false);
    expect(isE2eSpec("apps/backoffice/e2e/f1.spec.ts")).toBe(true);
    expect(isIntegrationTest("apps/api/test/booking.e2e-spec.ts")).toBe(true);
    expect(isIntegrationTest("packages/base/test/schedule.test.ts")).toBe(false);
    expect(isTestSide("packages/base/test/fixtures/personas.ts")).toBe(true);
    expect(isTestSide("packages/base/src/booking/booking.service.ts")).toBe(false);
  });

  it("parses the diff spec and named tests in any order", () => {
    expect(parseReproArgs(["packages/base/test/a.test.ts", "--cached"])).toEqual({
      diffArg: "--cached",
      tests: ["packages/base/test/a.test.ts"],
    });
  });
});

describe("commitlint fix-needs-repro", () => {
  const fix = (body: string) => ({ type: "fix", raw: `fix(x): y\n\n${body}` });

  it("ignores other commit types", () => {
    expect(fixNeedsRepro({ type: "feat", raw: "feat: x" })[0]).toBe(true);
  });

  it("refuses a fix with no trailer", () => {
    expect(fixNeedsRepro(fix("Body only."))[0]).toBe(false);
  });

  it("accepts a Repro-Test trailer", () => {
    expect(fixNeedsRepro(fix("Repro-Test: apps/web/src/a.test.ts"))[0]).toBe(true);
  });

  it("accepts not testable with a reason, refuses it without one", () => {
    expect(fixNeedsRepro(fix("Repro: not testable — Safari-only layout glitch"))[0]).toBe(true);
    expect(fixNeedsRepro(fix("Repro: not testable — n/a"))[0]).toBe(false);
  });
});

describe("review gates — follow-ups from the first /review", () => {
  it("accepts a verdict however the reviewer punctuates it", () => {
    const report = [
      "- [a-1]: Applies, checked, passes",
      "- [a-2] — not relevant — no overrides touched",
      "* [a-3] APPLIES — checked",
      "- [a-4] see the note above",
    ].join("\n");
    expect([...answeredIds(report)]).toEqual(["a-1", "a-2", "a-3"]);
  });

  describe("stampProblems — when the review stamp may be written", () => {
    const green = { diffHash: "abc", gates: [{ status: "pass" }, { status: "skip" }] };
    it("refuses with no preflight result", () => {
      expect(stampProblems(null, "abc")).toEqual([
        "no preflight result — run pnpm review:preflight first",
      ]);
    });
    it("refuses a preflight of another diff", () => {
      expect(stampProblems(green, "def")[0]).toMatch(/different diff/);
    });
    it("refuses a red preflight", () => {
      expect(stampProblems({ diffHash: "abc", gates: [{ status: "fail" }] }, "abc")).toEqual([
        "the last preflight was red",
      ]);
    });
    it("allows a green preflight of this diff", () => {
      expect(stampProblems(green, "abc")).toEqual([]);
    });
  });

  it.each([
    [["--cached"], "HEAD"],
    [["HEAD"], "HEAD"],
    [["origin/main...HEAD"], "origin/main"],
    [["v1.2.0"], "v1.2.0"],
  ])("baseRef(%j) → %s (decides whether a feature folder is new)", (diffArgs, base) => {
    expect(baseRef({ label: "x", diffArgs })).toBe(base);
  });

  it("strips git's own variables from the proof's environment", () => {
    const env = childEnv({ PATH: "/bin", GIT_INDEX_FILE: "/r/.git/index", GIT_DIR: "/r/.git" });
    expect(env).toEqual({ PATH: "/bin", FORCE_COLOR: "0" });
  });

  it("repro parseArgs: no arguments, and a ./ prefix", () => {
    expect(parseReproArgs([])).toEqual({ diffArg: undefined, tests: [] });
    expect(parseReproArgs(["./apps/web/src/a.test.ts"]).tests).toEqual(["apps/web/src/a.test.ts"]);
  });

  describe("fix-needs-repro edges", () => {
    const fix = (body: string) => ({ type: "fix", raw: `fix(x): y\n\n${body}` });
    it("treats an empty Repro-Test as no trailer", () => {
      expect(fixNeedsRepro(fix("Repro-Test:"))[0]).toBe(false);
    });
    it("accepts -- as the separator", () => {
      expect(fixNeedsRepro(fix("Repro: not testable -- Safari-only layout glitch"))[0]).toBe(true);
    });
    it("pins the 10-character reason boundary", () => {
      expect(fixNeedsRepro(fix("Repro: not testable — 0123456789"))[0]).toBe(true);
      expect(fixNeedsRepro(fix("Repro: not testable — 012345678"))[0]).toBe(false);
    });
    it("reads the trailer through git's comment block", () => {
      const raw =
        "fix(x): y\n\nRepro-Test: apps/web/src/a.test.ts\n# Please enter the commit message\n#\n";
      expect(fixNeedsRepro({ type: "fix", raw })[0]).toBe(true);
    });
  });

  it("keeps a screen component out of the security reviewer", () => {
    expect([...reviewRoles(["apps/backoffice/src/app/cases/page.tsx"]).keys()]).not.toContain(
      "security",
    );
  });
});

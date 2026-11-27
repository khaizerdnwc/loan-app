import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageDirOf } from "../src/_review";
import {
  applyHouseFixes,
  eslintProblems,
  isHouseFix,
  isLintable,
  mustFail,
  parseArgs,
  touchesDatabaseBehaviour,
} from "../src/review-preflight";

const base = "/repo/apps/web";
const report = (messages: object[], filePath = `${base}/src/features/a/x.ts`) =>
  JSON.stringify([{ filePath, messages, source: "const secret = 1; // never printed" }]);

describe("eslintProblems", () => {
  it("keeps errors, strips the base path, and names the rule", () => {
    const out = eslintProblems(
      report([
        {
          line: 3,
          column: 7,
          message: "No raw db.",
          ruleId: "house/no-raw-db-outside-lib",
          severity: 2,
        },
      ]),
      base,
    );
    expect(out).toEqual(["src/features/a/x.ts:3:7 No raw db. [house/no-raw-db-outside-lib]"]);
  });

  it("drops warnings", () => {
    expect(
      eslintProblems(
        report([{ line: 1, column: 1, message: "w", ruleId: "x", severity: 1 }]),
        base,
      ),
    ).toEqual([]);
  });

  it("renders a parse error and missing positions", () => {
    expect(
      eslintProblems(report([{ message: "Unexpected token", ruleId: null, severity: 2 }]), base),
    ).toEqual(["src/features/a/x.ts:0:0 Unexpected token [parse]"]);
  });

  it("keeps only the first line of a multi-line message", () => {
    const [line] = eslintProblems(
      report([{ line: 2, column: 1, message: "first\nsecond", ruleId: "r", severity: 2 }]),
      base,
    );
    expect(line).toBe("src/features/a/x.ts:2:1 first [r]");
  });

  it("never passes on the source text ESLint embeds", () => {
    const out = eslintProblems(
      report([{ line: 1, column: 1, message: "m", ruleId: "r", severity: 2 }]),
      base,
    );
    expect(out.join("\n")).not.toContain("secret");
  });

  // Load-bearing: the gate falls back to the raw output tail only when this is empty.
  it("returns an empty list for output that is not JSON", () => {
    expect(eslintProblems("Oops! Something went wrong.", base)).toEqual([]);
  });
});

describe("parseArgs", () => {
  it.each([
    [["--cached"], false, false, "--cached"],
    [["--no-fix", "--cached"], true, false, "--cached"],
    [["--cached", "--no-fix"], true, false, "--cached"],
    [["--bugfix", "--cached"], false, true, "--cached"],
    [["origin/main", "--bugfix", "--no-fix"], true, true, "origin/main"],
    [[], false, false, undefined],
  ])("%j → noFix %s, bugfix %s, diff %s", (argv, noFix, bugfix, diffArg) => {
    expect(parseArgs(argv)).toEqual({ noFix, bugfix, diffArg });
  });
});

describe("isHouseFix", () => {
  it("lets only house rules rewrite files", () => {
    expect(isHouseFix({ ruleId: "house/require-timestamptz" })).toBe(true);
    expect(isHouseFix({ ruleId: "prefer-const" })).toBe(false);
    expect(isHouseFix({ ruleId: null })).toBe(false);
  });
});

describe("mustFail", () => {
  it("fails on a red gate, and on a staged review the autofix changed", () => {
    expect(mustFail(1, 0, "working tree vs HEAD")).toBe(true);
    expect(mustFail(0, 2, "--cached")).toBe(true);
    expect(mustFail(0, 2, "working tree vs HEAD")).toBe(false);
    expect(mustFail(0, 0, "--cached")).toBe(false);
  });
});

describe("applyHouseFixes", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "house-fix-"));
    // One fixable house rule and one fixable core rule, both on.
    writeFileSync(
      join(dir, "eslint.config.js"),
      `export default [{
        plugins: { house: { rules: { mark: {
          meta: { fixable: "code" },
          create(context) {
            return { Program(node) {
              if (!context.sourceCode.text.startsWith("// fixed"))
                context.report({ node, message: "x", fix: (f) => f.insertTextBeforeRange([0, 0], "// fixed\\n") });
            } };
          },
        } } } },
        rules: { "house/mark": "error", "prefer-const": "error" },
      }];\n`,
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("applies the house fix, leaves the core rule's fix alone, and reports repo paths", async () => {
    writeFileSync(join(dir, "a.js"), "let a = 1;\nexport { a };\n");
    const changed = await applyHouseFixes(["a.js"], dir, join(dir, ".."));
    expect(changed).toEqual([join(basename(dir), "a.js")]);
    const text = readFileSync(join(dir, "a.js"), "utf8");
    expect(text.startsWith("// fixed\n")).toBe(true);
    expect(text).toContain("let a = 1;"); // prefer-const would have made it const
  });

  it("returns nothing for a clean file", async () => {
    writeFileSync(join(dir, "b.js"), "// fixed\nexport const b = 1;\n");
    expect(await applyHouseFixes(["b.js"], dir, dir)).toEqual([]);
  });
});

describe("workspace grouping", () => {
  it("finds the package that owns a file", () => {
    expect(packageDirOf("packages/base/src/booking/booking.service.ts")).toBe("packages/base");
    expect(packageDirOf("apps/backoffice/src/app/page.tsx")).toBe("apps/backoffice");
    expect(packageDirOf("tools/review/src/lessons.ts")).toBe("tools/review");
    expect(packageDirOf("docs/ACCEPTANCE.md")).toBeNull();
    expect(packageDirOf("package.json")).toBeNull();
  });

  it("lints source and tests in every package, nothing else", () => {
    expect(isLintable("apps/api/src/main.ts")).toBe(true);
    expect(isLintable("apps/api/test/booking.e2e-spec.ts")).toBe(true);
    expect(isLintable("apps/backoffice/e2e/f1.spec.ts")).toBe(true);
    expect(isLintable("packages/ui/src/button.tsx")).toBe(true);
    expect(isLintable("tools/review/src/lessons.ts")).toBe(true);
    expect(isLintable("apps/backoffice/next.config.ts")).toBe(false);
    expect(isLintable("docs/x.ts")).toBe(false);
  });

  it("runs the database suite when API, domain or money code changes", () => {
    expect(touchesDatabaseBehaviour("packages/base/src/booking/booking.service.ts")).toBe(true);
    expect(touchesDatabaseBehaviour("packages/core/src/money/money.ts")).toBe(true);
    expect(touchesDatabaseBehaviour("apps/api/test/booking.e2e-spec.ts")).toBe(true);
    expect(touchesDatabaseBehaviour("apps/backoffice/src/app/page.tsx")).toBe(false);
    expect(touchesDatabaseBehaviour("packages/ui/src/button.tsx")).toBe(false);
  });
});

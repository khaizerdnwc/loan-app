import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkHouseRuleParity, ruleTesterRun } from "../src/_house-rules";

describe("ruleTesterRun", () => {
  const tests = `
    ruleTester.run("a-rule", a, { valid: [{ code: "x" }], invalid: [{ code: "y", errors: [] }] });
    ruleTester.run("b-rule", b, { valid: [], invalid: [] });
  `;

  it("returns only that rule's run", () => {
    const run = ruleTesterRun(tests, "a-rule") ?? "";
    expect(run).toContain('"a-rule"');
    expect(run).not.toContain('"b-rule"');
  });

  it("returns null when there is no run", () => {
    expect(ruleTesterRun(tests, "c-rule")).toBeNull();
  });
});

describe("checkHouseRuleParity", () => {
  let app: string;
  const write = (rel: string, content: string) => {
    const p = join(app, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };
  const registry = (names: string[]) => {
    write(
      "packages/eslint-house/src/index.js",
      `/**\n * Rules:\n${names.map((n) => ` *   - ${n} : does a thing`).join("\n")}\n */\n` +
        `export default {\n  rules: {\n${names.map((n) => `    "${n}": r,`).join("\n")}\n  },\n};\n`,
    );
    write(
      "eslint.config.js",
      `export default { rules: { ${names.map((n) => `"house/${n}": "error"`).join(", ")} } };\n`,
    );
    for (const n of names) write(`packages/eslint-house/src/rules/${n}.js`, "export default {};\n");
  };

  beforeEach(() => {
    app = mkdtempSync(join(tmpdir(), "house-rules-"));
  });
  afterEach(() => rmSync(app, { recursive: true, force: true }));

  it("passes a rule with a valid and an invalid case", () => {
    registry(["good-rule"]);
    write(
      "packages/eslint-house/test/x.test.ts",
      `ruleTester.run("good-rule", r, { valid: [{ code: "a" }], invalid: [{ code: "b", errors: [] }] });`,
    );
    expect(checkHouseRuleParity(app)).toEqual([]);
  });

  it("fails a run with no invalid case — it proves nothing is ever refused", () => {
    registry(["lax-rule"]);
    write(
      "packages/eslint-house/test/x.test.ts",
      `ruleTester.run("lax-rule", r, { valid: [{ code: "a" }], invalid: [] });`,
    );
    expect(checkHouseRuleParity(app).join("\n")).toMatch(/lax-rule: .*one valid AND one invalid/);
  });

  it("does not count a commented-out run", () => {
    registry(["gone-rule"]);
    write(
      "packages/eslint-house/test/x.test.ts",
      `// ruleTester.run("gone-rule", r, { valid: [{ code: "a" }], invalid: [{ code: "b" }] });`,
    );
    expect(checkHouseRuleParity(app).join("\n")).toMatch(
      /gone-rule: missing from any RuleTester run/,
    );
  });

  it("names every place a rule is missing from", () => {
    registry([]);
    write("packages/eslint-house/src/index.js", "/**\n */\nexport default { rules: {} };\n");
    write("packages/eslint-house/src/rules/orphan.js", "export default {};\n");
    write("packages/eslint-house/test/x.test.ts", "");
    const [problem] = checkHouseRuleParity(app);
    expect(problem).toMatch(
      /orphan: missing from the src\/index\.js header, the src\/index\.js rules map, the root eslint\.config\.js/,
    );
  });
});

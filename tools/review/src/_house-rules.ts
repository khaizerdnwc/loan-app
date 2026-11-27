/**
 * House-rule registry parity, used by `pnpm house:check` (ADR 0016).
 *
 * The rules live in one shared package, packages/eslint-house, loaded by the one root
 * eslint.config.js:
 *   src/rules/<name>.js   one rule per file
 *   src/index.js          header comment (the documented list) + the rules map
 *   test/*.test.ts        RuleTester runs (Vitest)
 * The header is the documented list of rules — other docs point at it instead of copying
 * it. In nxlvl it drifted and founding rules went untested, because prose has no test.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The text of `ruleTester.run("<rule>", …)` up to the next run, or null when there is none. */
export function ruleTesterRun(tests: string, rule: string): string | null {
  const start = tests.search(new RegExp(`\\.run\\(\\s*"${rule}"`));
  if (start < 0) return null;
  const next = tests.slice(start + 5).search(/\.run\(\s*"/);
  return next < 0 ? tests.slice(start) : tests.slice(start, start + 5 + next);
}

/**
 * Every house rule is registered, configured, listed, and tested by a RuleTester run with
 * at least one valid and one invalid case. Returns one problem line per rule; empty is ok.
 */
export function checkHouseRuleParity(repoRoot: string): string[] {
  const pkg = resolve(repoRoot, "packages", "eslint-house");
  const dir = resolve(pkg, "src", "rules");
  const testsDir = resolve(pkg, "test");
  if (!existsSync(dir)) return [];
  const rules = readdirSync(dir)
    .filter((f) => f.endsWith(".js") && f !== "index.js" && !f.startsWith("_"))
    .map((f) => f.slice(0, -3))
    .sort();

  const index = readFileSync(resolve(pkg, "src", "index.js"), "utf8");
  const headerEnd = index.indexOf("*/");
  const header = new Set(
    [...index.slice(0, headerEnd).matchAll(/^\s*\*\s+-\s+([a-z0-9-]+)\s*:/gm)].map(
      (m) => m[1] as string,
    ),
  );
  const registered = new Set(
    [...index.matchAll(/^\s+"([a-z0-9-]+)":\s*[A-Za-z]\w*,?$/gm)].map((m) => m[1] as string),
  );
  const config = readFileSync(resolve(repoRoot, "eslint.config.js"), "utf8");
  // Comments stripped, so a commented-out run does not count as a test.
  const tests = readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => readFileSync(resolve(testsDir, f), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const problems: string[] = [];
  for (const rule of rules) {
    const missing: string[] = [];
    if (!header.has(rule)) missing.push("the src/index.js header");
    if (!registered.has(rule)) missing.push("the src/index.js rules map");
    if (!config.includes(`"house/${rule}"`)) missing.push("the root eslint.config.js");
    const run = ruleTesterRun(tests, rule);
    if (run === null) missing.push("any RuleTester run");
    else if (!/\bvalid:\s*\[\s*[{`"']/.test(run) || !/\binvalid:\s*\[\s*\{/.test(run)) {
      missing.push("a RuleTester run with at least one valid AND one invalid case");
    }
    if (missing.length > 0) problems.push(`${rule}: missing from ${missing.join(", ")}`);
  }
  for (const name of new Set([...header, ...registered])) {
    if (!rules.includes(name)) problems.push(`${name}: listed in index.js but has no rule file`);
  }
  return problems;
}

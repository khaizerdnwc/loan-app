#!/usr/bin/env tsx
/**
 * pnpm house:check — every deterministic cross-file check, plus the lessons ledgers
 * (ADR 0016). Replaces nxlvl's features:check: this repo has no feature manifests, so what
 * remains is the check registry (tools/review/src/checks/) and checkLedgers().
 *
 * Runs in review:preflight, in the `static` stage of `pnpm verify` (pre-push and the pull
 * request), and on its own. Exit 1 on any finding.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkLedgers, findRepoRoot, hasTooling } from "./_lessons";
import { checksDir, loadChecks, runChecks } from "./checks/_registry";

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const fullCheckout = hasTooling(repoRoot);
  if (!fullCheckout && process.env.CI === "true") {
    console.error("house:check: .claude/ is missing in CI — the lessons ledgers cannot be checked");
    process.exit(1);
  }

  const problems: string[] = [];
  const checks = await loadChecks(checksDir(repoRoot));
  const results = await runChecks(checks, { repoRoot, fullCheckout });
  let waived = 0;
  for (const r of results) {
    waived += r.waived;
    for (const f of r.findings) {
      problems.push(`${f.file}${f.line ? `:${f.line}` : ""}: [check:${r.id}] ${f.message}`);
    }
  }
  if (fullCheckout && existsSync(join(repoRoot, ".claude", "skills"))) {
    for (const p of checkLedgers(repoRoot)) problems.push(`${p} [lessons]`);
  }

  const ran = results.length;
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error(`house:check: ${problems.length} problem(s) from ${ran} checks + ledgers`);
    process.exit(1);
  }
  console.info(
    `house:check: ✔ ${ran} checks + lessons ledgers clean${waived ? ` (${waived} waived finding(s))` : ""}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * pnpm lessons <command> — the deterministic side of the learning loop (ADR 0016).
 *
 *   check                      Validate every role's lessons.md + lessons-log.md: grammar,
 *                              budget, ids, gates. Exit 1 on any problem. Also run by
 *                              features:check.
 *   for <file...> [--role r]   Print the ungated lessons whose paths match those files.
 *                              This — not the whole file — is what an implementer or a
 *                              reviewer reads.
 *   show <id | house/<rule> | check:<id>>
 *                              Print one lesson's full narrative from the log, or every
 *                              narrative a rule or registered check enforces (use it when
 *                              one fires and you want the why).
 *   stats                      Per role: gated, prose, merged, retired, budget used. Report only.
 */
import { relative } from "node:path";
import {
  checkLedgers,
  findRepoRoot,
  hasTooling,
  LESSONS_BUDGET_BYTES,
  lessonsFor,
  loadAllLedgers,
} from "./_lessons";

const root = findRepoRoot();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value`);
  args.splice(i, 2);
  return value;
}

function cmdCheck(): void {
  const problems = checkLedgers(root);
  if (problems.length === 0) {
    console.info("✔ lessons valid");
    return;
  }
  console.error(`✖ ${problems.length} lessons problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

function cmdFor(args: string[]): void {
  const role = takeFlag(args, "--role");
  if (args.length === 0) fail("usage: pnpm lessons for <file...> [--role <role>]");
  const matched = lessonsFor(root, args, role);
  if (matched.length === 0) {
    console.info("(no ungated lessons for these files)");
    return;
  }
  let current = "";
  for (const l of matched) {
    if (l.role !== current) {
      current = l.role;
      if (!role) console.info(`${current}:`);
    }
    console.info(l.raw);
  }
}

function cmdShow(args: string[]): void {
  const key = args[0];
  if (!key) fail("usage: pnpm lessons show <id | house/<rule> | check:<id>>");
  const all = loadAllLedgers(root).flatMap((l) => l.log.map((e) => ({ ...e, file: l.logPath })));
  const hits = /^(house\/|check:)/.test(key)
    ? all.filter((e) => e.gate?.split(",").some((g) => g.trim() === key))
    : all.filter((e) => e.id === key);
  if (hits.length === 0) fail(`no lesson found for "${key}"`);
  for (const e of hits) {
    console.info(`## ${e.id}  (${relative(root, e.file)}:${e.line})\n${e.body}\n`);
  }
}

function cmdStats(): void {
  const rows = loadAllLedgers(root).map((l) => {
    const prose = new Set(l.lessons.map((x) => x.id));
    const gated = l.log.filter((e) => e.gate).length;
    const merged = l.log.filter((e) => /^Merged into /m.test(e.body)).length;
    const retired = l.log.filter(
      (e) => !e.gate && !prose.has(e.id) && !/^Merged into /m.test(e.body),
    ).length;
    return {
      role: l.role,
      gated,
      prose: prose.size,
      merged,
      retired,
      budget: `${l.weightedBytes}/${LESSONS_BUDGET_BYTES}`,
    };
  });
  const header = ["role", "gated", "prose", "merged", "retired", "budget (bytes)"];
  const cells = rows.map((r) => [
    r.role,
    `${r.gated}`,
    `${r.prose}`,
    `${r.merged}`,
    `${r.retired}`,
    r.budget,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] ?? "").length)));
  const fmt = (c: string[]) => c.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ");
  console.info(fmt(header));
  for (const c of cells) console.info(fmt(c));
  const gated = rows.reduce((n, r) => n + r.gated, 0);
  const prose = rows.reduce((n, r) => n + r.prose, 0);
  const total = gated + prose;
  if (total > 0) {
    console.info(
      `${gated} of ${total} live lessons are enforced by a gate (${Math.round((gated * 100) / total)}%).`,
    );
  }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (!hasTooling(root)) {
    console.info("lessons: .claude/ is not present here (e.g. a Docker build); nothing to do");
    return;
  }
  switch (command) {
    case "check":
      cmdCheck();
      return;
    case "for":
      cmdFor(args);
      return;
    case "show":
      cmdShow(args);
      return;
    case "stats":
      cmdStats();
      return;
    default:
      fail(
        "usage: pnpm lessons <check | for <file...> [--role r] | show <id|house/rule|check:id> | stats>",
      );
  }
}

main();

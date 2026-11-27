#!/usr/bin/env tsx
/**
 * pnpm review:ack [--cached | <base-ref>] [--stamp] — check that every reviewer answered
 * every lesson it was given, then (with --stamp) record the review stamp (ADR 0017).
 *
 * A prose lesson only helps if the reviewer actually weighs it. Each `<role>-review`
 * report carries a `Lessons` section with one line per lesson id:
 *
 *   - [<id>] applies — checked: <what was looked at>
 *   - [<id>] not relevant — <why>
 *
 * /review saves each report to .claude/.review/<role>.report.md. This recomputes which
 * roles and lessons the diff needs (the same code as `pnpm review:roles`) and fails on any
 * report that is missing, or any lesson id without a verdict.
 *
 * --stamp: when that holds AND the last preflight for this exact diff was green, write
 * `.claude/.review-stamp` — the fingerprint the commit lock compares. The stamp is written
 * by this check, not by hand, so a review that skipped a gate or a lesson cannot stamp.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot, lessonsFor } from "./_lessons";
import {
  changedFiles,
  hashDiff,
  newFeatureDirs,
  type Role,
  resolveDiff,
  reviewDir,
  reviewRoles,
} from "./_review";

// Tolerant of how a reviewer punctuates it — `[id] applies`, `[id]: Applies`, `[id] — not
// relevant` — but a verdict word must follow the id directly, so a lesson merely mentioned
// in prose does not count as answered.
const VERDICT = /^\s*[-*]\s*\[([a-z0-9-]+)\]\s*[:—–-]?\s*(applies|not relevant)\b/gim;

/** Lesson ids a report answered with a verdict. */
export function answeredIds(report: string): Set<string> {
  return new Set([...report.matchAll(VERDICT)].map((m) => m[1] as string));
}

/** Per role, the expected ids that the report does not answer. */
export function missingAnswers(
  expected: ReadonlyMap<Role, readonly string[]>,
  reports: ReadonlyMap<Role, string | null>,
): string[] {
  const problems: string[] = [];
  for (const [role, ids] of expected) {
    const report = reports.get(role) ?? null;
    if (report === null) {
      problems.push(`${role}: no report saved at .claude/.review/${role}.report.md`);
      continue;
    }
    const answered = answeredIds(report);
    const missing = ids.filter((id) => !answered.has(id));
    if (missing.length) problems.push(`${role}: no verdict for ${missing.join(", ")}`);
  }
  return problems;
}

export interface PreflightResult {
  diffHash: string;
  gates: { status: string }[];
}

/** Why the review stamp must not be written for `diffHash`, if anything. */
export function stampProblems(result: PreflightResult | null, diffHash: string): string[] {
  if (!result) return ["no preflight result — run pnpm review:preflight first"];
  if (result.diffHash !== diffHash) {
    return ["the last preflight was for a different diff — run it again"];
  }
  if (result.gates.some((g) => g.status === "fail")) return ["the last preflight was red"];
  return [];
}

function main(): void {
  const root = findRepoRoot();
  const argv = process.argv.slice(2);
  const stamp = argv.includes("--stamp");
  const spec = resolveDiff(
    root,
    argv.find((a) => a !== "--stamp"),
  );
  const files = changedFiles(root, spec);
  if (files.length === 0) {
    console.info(`review:ack: nothing changed (${spec.label})`);
    return;
  }
  const dir = reviewDir(root);
  const roles = reviewRoles(files, newFeatureDirs(root, spec, files));
  const expected = new Map<Role, string[]>();
  const reports = new Map<Role, string | null>();
  for (const [role, mine] of roles) {
    expected.set(
      role,
      lessonsFor(root, mine, role).map((l) => l.id),
    );
    const path = join(dir, `${role}.report.md`);
    reports.set(role, existsSync(path) ? readFileSync(path, "utf8") : null);
  }

  const problems = missingAnswers(expected, reports);
  const diffHash = hashDiff(root, spec);
  if (stamp) {
    const pre = join(dir, "preflight.json");
    const result = existsSync(pre)
      ? (JSON.parse(readFileSync(pre, "utf8")) as PreflightResult)
      : null;
    problems.push(...stampProblems(result, diffHash));
  }

  if (problems.length) {
    console.error(`✖ review:ack (${spec.label}) — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error(
      "Send each reviewer its missing lesson ids, save the new report, run this again.",
    );
    process.exit(1);
  }
  const total = [...expected.values()].reduce((n, ids) => n + ids.length, 0);
  console.info(`✔ review:ack (${spec.label}) — ${roles.size} role(s), ${total} lesson(s) answered`);
  if (stamp) {
    writeFileSync(join(root, ".claude", ".review-stamp"), `${diffHash}\n`);
    console.info(`✔ review stamp written (${diffHash.slice(0, 7)})`);
  }
}

if (process.argv[1]?.endsWith("review-ack.ts")) main();

#!/usr/bin/env tsx
/**
 * pnpm review:preflight [--cached | <base-ref>] — the deterministic gates, on the changed
 * files, BEFORE any reviewer agent is spawned (ADR 0016).
 *
 * A reviewer that re-finds what lint finds is paid to run a linter. So `/review` runs this
 * first: red means fix it and spawn nobody; green means every house rule, the type checker,
 * the house checks and the related unit tests have already passed on these files, and
 * reviewers spend their tokens on what no gate can decide.
 *
 * The repo is a pnpm workspace (apps/*, packages/*, tools/*). Changed files are grouped by
 * the workspace package that owns them: ESLint runs once from the root (one flat config
 * covers every package), typecheck runs through turbo for the changed packages AND their
 * dependents, and related tests run per package with that package's runner (Jest for the
 * API side, Vitest for the web side and tooling).
 *
 * Resolves the diff the way /review does: the argument if given, otherwise the working
 * tree against HEAD, then the staged diff, then the branch against origin/main.
 *
 * Gates run on the WORKING TREE. With --cached, stage everything you mean to commit first,
 * or the results describe files that differ from the diff being reviewed.
 *
 * Step 0 applies the fixes of house rules that have exactly one correct rewrite (ESLint's
 * `fix()`, filtered to `house/*` so no third-party rule rewrites anything) to the changed
 * files, and says which files it touched. That is a learned lesson applied by a tool, not
 * by a model remembering it. `--no-fix` skips it.
 *
 * Prints a short summary (this is what gets pasted into reviewer prompts) and writes the
 * full result to .claude/.review/preflight.json. Exit 1 when any gate is red.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { findRepoRoot } from "./_lessons";
import {
  changedFiles,
  git as gitAt,
  hashDiff as hashDiffAt,
  packageDirOf,
  readPackage,
  resolveDiff,
  type WorkspacePackage,
} from "./_review";

type Status = "pass" | "fail" | "skip";
interface Gate {
  name: string;
  status: Status;
  note: string;
  output: string;
}

const root = findRepoRoot();
const git = (args: string[]) => gitAt(root, args);
const DETAIL_LINES = 8;
/** A hung gate must fail the preflight, not hang /review. */
const GATE_TIMEOUT_MS = 5 * 60_000;

interface RunResult {
  code: number;
  /** stdout and stderr interleaved, for humans. */
  out: string;
  /** stdout alone, for machine-readable formats. */
  stdout: string;
}

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return new Promise<RunResult>((done) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env, FORCE_COLOR: "0" } });
    let out = "";
    let stdout = "";
    const timer = setTimeout(() => {
      out += `\n✖ timed out after ${GATE_TIMEOUT_MS / 60_000} minutes`;
      child.kill("SIGKILL");
    }, GATE_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d;
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, out, stdout });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: 1, out: String(err), stdout: "" });
    });
  });
}

/**
 * ESLint's JSON report reduced to `file:line:col message [rule]`. ESLint 9 dropped the
 * `unix` formatter, and the JSON one embeds each file's full source — which must never
 * reach a reviewer prompt, so only this summary is kept.
 */
export function eslintProblems(json: string, base: string): string[] {
  let results: {
    filePath: string;
    messages: {
      line?: number;
      column?: number;
      message: string;
      ruleId: string | null;
      severity: number;
    }[];
  }[];
  try {
    results = JSON.parse(json);
  } catch {
    return [];
  }
  return results.flatMap((r) =>
    r.messages
      .filter((m) => m.severity === 2)
      .map(
        (m) =>
          `${r.filePath.replace(`${base}/`, "")}:${m.line ?? 0}:${m.column ?? 0} ${m.message.split("\n")[0]} [${m.ruleId ?? "parse"}]`,
      ),
  );
}

const tail = (text: string, n = DETAIL_LINES) =>
  text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !/^\s*(>|ELIFECYCLE|ERR_PNPM)/.test(l))
    .slice(-n);

async function gate(
  name: string,
  skipReason: string | null,
  exec: () => Promise<RunResult>,
  pick: (r: RunResult) => string[] = (r) => tail(r.out),
): Promise<Gate> {
  if (skipReason) return { name, status: "skip", note: skipReason, output: "" };
  const result = await exec();
  const pass = result.code === 0;
  return {
    name,
    status: pass ? "pass" : "fail",
    note: pass ? "" : pick(result).join("\n") || tail(result.out).join("\n"),
    // Never persist ESLint's JSON: it embeds whole source files.
    output: name === "eslint" ? pick(result).join("\n") : result.out.slice(-20_000),
  };
}

/** Source and test files the house ESLint config covers. */
export function isLintable(file: string): boolean {
  return (
    /\.(ts|tsx|js|mjs)$/.test(file) &&
    /^(apps\/[^/]+\/(src|test|e2e)|packages\/[^/]+\/(src|test)|tools\/[^/]+\/(src|test))\//.test(
      file,
    )
  );
}

/** Files whose change can break tests in their package. */
export function isTestRelevant(file: string): boolean {
  return /\.(ts|tsx|js)$/.test(file) && /^(apps|packages|tools)\/[^/]+\/(src|test)\//.test(file);
}

/** Changes the database-backed integration suite must see. */
export function touchesDatabaseBehaviour(file: string): boolean {
  return /^(packages\/base\/src|apps\/api\/src|apps\/api\/test|packages\/core\/src)\//.test(file);
}

const FLAGS = ["--no-fix", "--bugfix"];

/** Flags may come before or after the diff spec; the first other argument is the spec. */
export function parseArgs(argv: string[]): {
  noFix: boolean;
  bugfix: boolean;
  diffArg: string | undefined;
} {
  return {
    noFix: argv.includes("--no-fix"),
    bugfix: argv.includes("--bugfix"),
    diffArg: argv.filter((a) => !FLAGS.includes(a))[0],
  };
}

/** Only house rules may rewrite files: a third-party fixer never runs unasked. */
export function isHouseFix(message: { ruleId: string | null }): boolean {
  return message.ruleId?.startsWith("house/") ?? false;
}

/**
 * Red when a gate failed — and, for a staged review, whenever the autofix rewrote a file:
 * the staged diff then no longer matches what the gates checked.
 */
export function mustFail(redGates: number, autofixed: number, label: string): boolean {
  return redGates > 0 || (autofixed > 0 && label === "--cached");
}

/**
 * Apply house-rule autofixes to `files` (relative to `cwd`, the repo root). Returns the
 * paths it changed, relative to `repoRoot`.
 */
export async function applyHouseFixes(
  files: string[],
  cwd: string,
  repoRoot: string,
): Promise<string[]> {
  if (files.length === 0) return [];
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({ cwd, fix: isHouseFix });
  const results = await eslint.lintFiles(files);
  await ESLint.outputFixes(results);
  return results.filter((r) => r.output !== undefined).map((r) => relative(repoRoot, r.filePath));
}

async function main(): Promise<void> {
  const { noFix, bugfix: bugfixFlag, diffArg } = parseArgs(process.argv.slice(2));
  const spec = resolveDiff(root, diffArg);
  const { label } = spec;
  // A new file is untracked until staged, and `git diff HEAD` does not list it, so a
  // working-tree diff adds untracked files — or a brand-new feature is never checked.
  const changed = changedFiles(root, spec);
  const hashDiff = () => hashDiffAt(root, spec);
  let diffHash = hashDiff();
  // A bug fix must prove its test reproduces the bug (ADR 0017): asked for by /fix-bug's
  // `--bugfix`, or implied by a fix/ branch.
  const bugfix = bugfixFlag || git(["branch", "--show-current"]).trim().startsWith("fix/");

  const outDir = join(root, ".claude", ".review");
  // A result from an earlier diff must never be read as this one's.
  rmSync(join(outDir, "preflight.json"), { force: true });

  if (changed.length === 0) {
    const noRemote = !git(["rev-parse", "--verify", "--quiet", "origin/main"]).trim();
    console.info(
      `preflight: nothing changed (${label})` +
        (noRemote
          ? " — note: origin/main is not available, so the branch diff was not checked"
          : ""),
    );
    return;
  }

  const lintable = changed.filter(isLintable);
  const lintConfigChanged = changed.some(
    (f) => f.startsWith("packages/eslint-house/") || f === "eslint.config.js",
  );
  const biomeable = changed.filter((f) => /\.(ts|tsx|js|mjs|cjs|json|jsonc|css)$/.test(f));
  // Types can break without a .ts edit: a tsconfig or a dependency change does it too.
  const tsChanged = changed.some(
    (f) => /\.(ts|tsx)$/.test(f) || /(^|\/)(tsconfig[^/]*\.json|package\.json)$/.test(f),
  );
  const rootPlumbing = changed.some((f) =>
    /^(package\.json|pnpm-lock\.yaml|tsconfig\.base\.json|turbo\.json)$/.test(f),
  );
  const packages = [...new Set(changed.map(packageDirOf).filter((d): d is string => Boolean(d)))]
    .map((dir) => readPackage(root, dir))
    .filter((p): p is WorkspacePackage => Boolean(p));
  const dbChanged = changed.some(touchesDatabaseBehaviour);
  const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

  // Step 0, before any gate reads the files.
  const autofixed = noFix ? [] : await applyHouseFixes(lintable, root, root);
  // The gates check the fixed files, so record the hash of what they checked.
  if (autofixed.length) diffHash = hashDiff();

  const pnpm = "pnpm";
  // Each changed package and every package that depends on it (turbo's `...pkg`), or
  // everything when root plumbing changed.
  const turboFilter = rootPlumbing ? [] : packages.map((p) => `--filter=...${p.name}`);
  const gates = await Promise.all([
    gate("biome", biomeable.length ? null : "no files Biome checks", () =>
      run(pnpm, ["exec", "biome", "check", "--no-errors-on-unmatched", ...biomeable], root),
    ),
    gate(
      "eslint",
      lintable.length || lintConfigChanged ? null : "no lintable source files",
      () =>
        run(
          pnpm,
          [
            "exec",
            "eslint",
            "--cache",
            "--no-warn-ignored",
            "--format",
            "json",
            ...(lintConfigChanged ? ["."] : lintable),
          ],
          root,
        ),
      (r) => {
        const problems = eslintProblems(r.stdout, root);
        const shown = problems.slice(0, DETAIL_LINES);
        if (problems.length > DETAIL_LINES) shown.push(`… ${problems.length - DETAIL_LINES} more`);
        return shown;
      },
    ),
    gate("house:check", null, () =>
      run(pnpm, ["exec", "tsx", "tools/review/src/house-check.ts"], root),
    ),
    gate(
      "typecheck",
      !tsChanged
        ? "no TypeScript changed"
        : !rootPlumbing && packages.length === 0
          ? "no workspace package changed"
          : null,
      () =>
        run(
          pnpm,
          ["exec", "turbo", "run", "typecheck", "--output-logs=errors-only", ...turboFilter],
          root,
        ),
    ),
  ]);

  // Tests after the static gates: they are the slow part, and pointless on code that does not type.
  for (const pkg of packages) {
    const mine = changed.filter((f) => f.startsWith(`${pkg.dir}/`) && isTestRelevant(f));
    const abs = mine.map((f) => join(root, f));
    const name = `unit ${pkg.name}`;
    if (!pkg.runner) {
      gates.push(
        await gate(name, "package has no test runner", async () => ({
          code: 0,
          out: "",
          stdout: "",
        })),
      );
      continue;
    }
    gates.push(
      await gate(name, mine.length ? null : "no source or test file changed", () =>
        pkg.runner === "jest"
          ? run(
              pnpm,
              [
                "--filter",
                pkg.name,
                "exec",
                "jest",
                "--findRelatedTests",
                "--passWithNoTests",
                ...abs,
              ],
              root,
            )
          : run(
              pnpm,
              [
                "--filter",
                pkg.name,
                "exec",
                "vitest",
                "related",
                "--run",
                "--passWithNoTests",
                ...abs,
              ],
              root,
            ),
      ),
    );
  }
  gates.push(
    await gate(
      "integration (API + Postgres)",
      !dbChanged
        ? "no API, domain or money files changed"
        : !hasTestDb
          ? "API or domain files changed but TEST_DATABASE_URL is unset — the PR's integration job runs it; run `pnpm test:integration` against a database to check now"
          : null,
      () =>
        run(
          pnpm,
          [
            "--filter",
            "@loan/api",
            "run",
            "test:integration",
            "--findRelatedTests",
            "--passWithNoTests",
            ...changed.filter(touchesDatabaseBehaviour).map((f) => join(root, f)),
          ],
          root,
        ),
    ),
  );
  // Last: a bug fix proves its test fails without the fix and passes with it (ADR 0017).
  gates.push(
    await gate(
      "repro proof",
      bugfix ? null : "not a bug fix (pass --bugfix, or use a fix/ branch)",
      () =>
        run(
          pnpm,
          ["exec", "tsx", "tools/review/src/repro-proof.ts", ...(diffArg ? [diffArg] : [])],
          root,
        ),
    ),
  );

  const red = gates.filter((g) => g.status === "fail");
  const mark = { pass: "✔", fail: "✖", skip: "·" } as const;
  console.info(`preflight (${label}, ${changed.length} files, diff ${diffHash.slice(0, 7)})`);
  if (autofixed.length) {
    console.info(`✎ house autofix rewrote ${autofixed.length} file(s):`);
    for (const f of autofixed) console.info(`    ${f}`);
    if (label === "--cached") {
      console.info("    These edits are not staged — `git add` them, then run preflight again.");
    }
  }
  for (const g of gates) {
    console.info(`${mark[g.status]} ${g.name}${g.status === "skip" ? ` — ${g.note}` : ""}`);
    if (g.status === "fail") for (const l of g.note.split("\n")) console.info(`    ${l}`);
  }
  console.info(
    red.length
      ? `✖ ${red.length} gate(s) red — fix these before spawning any reviewer`
      : "✔ gates green — reviewers need not re-check anything these gates cover",
  );

  if (existsSync(join(root, ".claude"))) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "preflight.json"),
      `${JSON.stringify({ label, diffHash, files: changed, autofixed, gates }, null, 2)}\n`,
    );
  }
  // A staged review of files the autofix just changed describes a diff that no longer
  // matches the working tree, so it cannot be green.
  if (mustFail(red.length, autofixed.length, label)) process.exit(1);
}

if (process.argv[1]?.endsWith("review-preflight.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

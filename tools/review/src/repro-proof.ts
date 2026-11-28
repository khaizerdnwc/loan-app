#!/usr/bin/env tsx
/**
 * pnpm review:repro [--cached | <base-ref>] [test files…] — prove a bug fix's test
 * reproduces the bug (ADR 0017).
 *
 * A test written alongside a fix proves nothing unless it would have failed without the
 * fix. This runs it both ways, in a throwaway git worktree so the user's checkout is never
 * touched:
 *
 *   1. base of the diff + ONLY the test changes  → at least one test case must FAIL
 *   2. base of the diff + the whole diff         → every test must PASS
 *
 * Tests are the changed vitest files of the diff (or the ones named). Playwright specs are
 * listed but not run — too heavy for a gate; reproduce in vitest, or commit with the
 * `Repro: not testable — <reason>` trailer. A failure to even LOAD the test without the
 * fix (it imports code the fix adds) does not count as reproducing the bug: assert through
 * an entry point that exists before the fix.
 *
 * Writes .claude/.review/repro-<diff hash>.json, which the commit-msg check reuses when the
 * staged diff is the same. Exit 1 when the proof does not hold.
 */
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { findRepoRoot } from "./_lessons";
import {
  changedFiles,
  type DiffSpec,
  git,
  hashDiff,
  packageDirOf,
  readPackage,
  resolveDiff,
  reviewDir,
} from "./_review";

const RUN_TIMEOUT_MS = 5 * 60_000;

/** A unit or integration test file run by Jest or Vitest (not a Playwright spec). */
export function isRunnableTest(file: string): boolean {
  return (
    /^(apps|packages|tools)\/[^/]+\//.test(file) &&
    /\.(test|spec|e2e-spec)\.tsx?$/.test(file) &&
    !/^apps\/[^/]+\/e2e\//.test(file)
  );
}

/** A Playwright spec: evidence for people, not run by the proof. */
export function isE2eSpec(file: string): boolean {
  return /^apps\/[^/]+\/e2e\/.+\.spec\.ts$/.test(file);
}

/** Any test-side file: test files, and fixtures/helpers living under a test folder. */
export function isTestSide(file: string): boolean {
  return (
    isRunnableTest(file) ||
    isE2eSpec(file) ||
    file.includes("/__tests__/") ||
    /^(apps|packages|tools)\/[^/]+\/test\//.test(file)
  );
}

/** Integration suites (API + Postgres) use their own Jest config. */
export function isIntegrationTest(file: string): boolean {
  return file.endsWith(".e2e-spec.ts");
}

export interface RunCounts {
  /** Exit code of vitest. */
  code: number;
  failedTests: number;
  passedTests: number;
  /** Test files that failed without any test case running (import or setup error). */
  suiteErrors: number;
}

export interface ProofVerdict {
  ok: boolean;
  reason: string;
}

/** The rule itself, separated from the running so it can be tested. */
export function judge(without: RunCounts, withFix: RunCounts): ProofVerdict {
  if (without.failedTests === 0) {
    return {
      ok: false,
      reason:
        without.suiteErrors > 0
          ? "without the fix the tests did not load (they import code the fix adds) — that is not the bug reproducing; assert through code that exists before the fix"
          : "the tests PASS without the fix, so they do not reproduce the bug (an integration test without TEST_DATABASE_URL skips — that counts as not reproduced)",
    };
  }
  if (withFix.code !== 0 || withFix.failedTests > 0 || withFix.suiteErrors > 0) {
    return { ok: false, reason: "the tests still FAIL with the fix applied" };
  }
  if (withFix.passedTests === 0) {
    return { ok: false, reason: "no test ran with the fix applied (all skipped?)" };
  }
  return { ok: true, reason: "fails without the fix, passes with it" };
}

/** Flags and the diff spec, in any order; anything that looks like a test file is a test. */
export function parseArgs(argv: string[]): { diffArg: string | undefined; tests: string[] } {
  const tests = argv.filter((a) => /\.(test|spec)\.tsx?$/.test(a));
  const rest = argv.filter((a) => !tests.includes(a));
  return { diffArg: rest[0], tests: tests.map((t) => t.replace(/^\.\//, "")) };
}

// ---------------------------------------------------------------------------

/**
 * The child environment, minus git's own `GIT_*` variables. Run from a commit-msg hook,
 * git exports GIT_INDEX_FILE / GIT_DIR; inherited by `git worktree add` or `git apply`
 * they would aim at the user's real index.
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) if (!k.startsWith("GIT_")) out[k] = v;
  out.FORCE_COLOR = "0";
  return out;
}

/**
 * Give the worktree a node_modules that borrows every installed package from `realDir`,
 * except workspace packages (links into this repo's own `packages/`), which point at the
 * worktree's copy instead. Otherwise a fix under packages/* would already be present in
 * the "without the fix" run, and its test would pass there.
 */
function mirrorModules(root: string, tree: string, realDir: string, treeDir: string): void {
  if (!existsSync(realDir) || existsSync(treeDir)) return;
  mkdirSync(treeDir, { recursive: true });
  for (const name of readdirSync(realDir)) {
    const real = join(realDir, name);
    const dest = join(treeDir, name);
    const stat = lstatSync(real);
    if (name.startsWith("@") && stat.isDirectory()) {
      mirrorModules(root, tree, real, dest); // a scope folder: mirror its entries
      continue;
    }
    let target = real;
    if (stat.isSymbolicLink()) {
      // pnpm writes workspace links as relative paths (../../packages/x): resolve the link
      // text from where it sits, not the fully resolved real path, so a node_modules that
      // is itself a link still maps onto this checkout's packages/.
      const resolved = resolve(realDir, readlinkSync(real));
      const rel = relative(root, resolved);
      if (!rel.startsWith("..") && !rel.split("/").includes("node_modules")) {
        target = join(tree, rel); // a workspace package: use the worktree's copy
      }
    }
    symlinkSync(target, dest);
  }
}

function sh(
  cmd: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: childEnv() });
    let out = "";
    const timer = setTimeout(() => {
      out += `\n✖ timed out after ${RUN_TIMEOUT_MS / 60_000} minutes`;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    if (input !== undefined) child.stdin.end(input);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, out });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: 1, out: String(err) });
    });
  });
}

/** Workspace package folders (`apps/*`, `packages/*`, `tools/*`) that exist in the checkout. */
function workspacePackages(root: string): string[] {
  return ["apps", "packages", "tools"].flatMap((top) => {
    const dir = join(root, top);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => lstatSync(join(dir, n)).isDirectory())
          .map((n) => `${top}/${n}`)
      : [];
  });
}

/**
 * Workspace packages whose entry point is compiled output (`main` under dist/), in the order to
 * build them. Their dist/ is not tracked, so a fresh worktree has none and anything importing
 * them (the backoffice's Vitest suites import @loan/core) would fail to load there.
 */
export function compiledPackages(root: string): string[] {
  const order = ["packages/core", "packages/contracts", "packages/base"];
  const compiled = workspacePackages(root).filter((dir) => {
    if (!dir.startsWith("packages/")) return false; // apps are run, not imported
    const manifest = join(root, dir, "package.json");
    if (!existsSync(manifest)) return false;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { main?: string };
    // Selected by what buildCompiled actually runs: tsc -p tsconfig.build.json.
    return Boolean(
      pkg.main?.replace(/^\.\//, "").startsWith("dist/") &&
        existsSync(join(root, dir, "tsconfig.build.json")),
    );
  });
  const rank = (d: string) => (order.includes(d) ? order.indexOf(d) : order.length);
  return compiled.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Build the compiled workspace packages inside the worktree (see compiledPackages). */
async function buildCompiled(tree: string): Promise<string | null> {
  // Read from the worktree: it is the state being built (base commit, then with the fix).
  for (const dir of compiledPackages(tree)) {
    const r = await sh(
      join(tree, "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.build.json"],
      join(tree, dir),
    );
    if (r.code !== 0) return `could not build ${dir} in the worktree: ${r.out.trim().slice(-800)}`;
  }
  return null;
}

/** The commit the diff is measured from. */
function baseCommit(root: string, spec: DiffSpec): string {
  const arg = spec.diffArgs[0] ?? "HEAD";
  if (arg === "--cached" || arg === "HEAD") return git(root, ["rev-parse", "HEAD"]).trim();
  if (arg.includes("...")) {
    const [a, b] = arg.split("...") as [string, string];
    return git(root, ["merge-base", a, b || "HEAD"]).trim();
  }
  return git(root, ["rev-parse", arg]).trim();
}

/** Bring `paths` from the diff into the worktree: tracked changes as a patch, untracked files by copy. */
async function applyPaths(
  root: string,
  tree: string,
  spec: DiffSpec,
  paths: string[],
): Promise<string> {
  if (paths.length === 0) return "";
  const patch = git(root, ["diff", "--binary", ...spec.diffArgs, "--", ...paths]);
  if (patch.trim()) {
    const r = await sh("git", ["apply", "--whitespace=nowarn", "-"], tree, patch);
    if (r.code !== 0) return `could not apply the diff to the base: ${r.out.trim()}`;
  }
  if (spec.label === "working tree vs HEAD") {
    const untracked = new Set(
      git(root, ["ls-files", "--others", "--exclude-standard", "--", ...paths])
        .split("\n")
        .filter(Boolean),
    );
    for (const f of untracked) {
      // Regular files only: a stray symlink (say, to a node_modules) is not part of a fix.
      if (!lstatSync(join(root, f)).isFile()) continue;
      mkdirSync(dirname(join(tree, f)), { recursive: true });
      copyFileSync(join(root, f), join(tree, f));
    }
  }
  return "";
}

async function runTests(
  tree: string,
  tests: string[],
  label: string,
): Promise<RunCounts & { out: string }> {
  // Group by owning package and by suite kind: each runs with its own runner and config.
  const groups = new Map<
    string,
    { dir: string; runner: "jest" | "vitest"; integration: boolean; files: string[] }
  >();
  for (const t of tests) {
    const dir = packageDirOf(t);
    const pkg = dir ? readPackage(tree, dir) : null;
    if (!dir || !pkg?.runner) continue;
    const integration = isIntegrationTest(t);
    const key = `${dir}|${integration}`;
    const g = groups.get(key) ?? { dir, runner: pkg.runner, integration, files: [] };
    g.files.push(t.slice(dir.length + 1));
    groups.set(key, g);
  }
  const total: RunCounts & { out: string } = {
    code: 0,
    failedTests: 0,
    passedTests: 0,
    suiteErrors: 0,
    out: "",
  };
  for (const g of groups.values()) {
    const cwd = join(tree, g.dir);
    const report = join(
      tree,
      `.repro-${label}-${g.dir.replace(/\//g, "_")}-${g.integration ? "int" : "unit"}.json`,
    );
    const r =
      g.runner === "jest"
        ? await sh(
            join(cwd, "node_modules", ".bin", "jest"),
            [
              ...(g.integration ? ["--config", "jest.integration.config.js", "--runInBand"] : []),
              "--json",
              `--outputFile=${report}`,
              ...g.files,
            ],
            cwd,
          )
        : await sh(
            join(cwd, "node_modules", ".bin", "vitest"),
            ["run", "--reporter=json", `--outputFile=${report}`, ...g.files],
            cwd,
          );
    total.code ||= r.code;
    total.out += `\n── ${label} · ${g.dir}${g.integration ? " (integration)" : ""}\n${r.out.slice(-4_000)}`;
    if (!existsSync(report)) {
      total.suiteErrors += g.files.length;
      continue;
    }
    const json = JSON.parse(readFileSync(report, "utf8")) as {
      numFailedTests: number;
      numPassedTests: number;
      testResults: { status: string; assertionResults: unknown[] }[];
    };
    total.failedTests += json.numFailedTests;
    total.passedTests += json.numPassedTests;
    total.suiteErrors += json.testResults.filter(
      (s) => s.status === "failed" && s.assertionResults.length === 0,
    ).length;
  }
  return total;
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  const { diffArg, tests: named } = parseArgs(process.argv.slice(2));
  const spec = resolveDiff(root, diffArg);
  const changed = changedFiles(root, spec);
  const diffHash = hashDiff(root, spec);

  const tests = (named.length ? named : changed).filter(isRunnableTest);
  const e2e = changed.filter(isE2eSpec);
  const product = changed.filter((f) => !isTestSide(f));

  const finish = (ok: boolean, reason: string, extra: object = {}) => {
    const out = reviewDir(root);
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, `repro-${diffHash}.json`),
      `${JSON.stringify({ ok, reason, diffHash, label: spec.label, tests, e2e, ...extra }, null, 2)}\n`,
    );
    console.info(
      `repro proof (${spec.label}, diff ${diffHash.slice(0, 7)}): ${ok ? "✔" : "✖"} ${reason}`,
    );
    for (const t of tests) console.info(`    test: ${t}`);
    if (e2e.length) console.info(`    not run (Playwright): ${e2e.join(", ")}`);
    // exitCode, not exit(): the worktree cleanup in `finally` must still run.
    if (!ok) process.exitCode = 1;
  };

  if (product.length === 0)
    return finish(false, "the diff changes no product code — there is no fix to prove");
  if (tests.length === 0) {
    return finish(
      false,
      e2e.length
        ? "only a Playwright spec changed — reproduce in a vitest test, or commit with `Repro: not testable — <reason>`"
        : "no vitest test changed — a bug fix needs a test that fails without it",
    );
  }

  const tree = mkdtempSync(join(tmpdir(), "loan-repro-"));
  rmSync(tree, { recursive: true, force: true });
  try {
    const add = await sh(
      "git",
      ["worktree", "add", "--detach", "--quiet", tree, baseCommit(root, spec)],
      root,
    );
    if (add.code !== 0) return finish(false, `could not create a worktree: ${add.out.trim()}`);
    // Borrow the installed dependencies and local env files; never replace what the
    // checkout already has.
    const link = (src: string, dest: string) => {
      if (existsSync(src) && !existsSync(dest)) symlinkSync(src, dest);
    };
    mirrorModules(root, tree, join(root, "node_modules"), join(tree, "node_modules"));
    for (const dir of workspacePackages(root)) {
      mirrorModules(root, tree, join(root, dir, "node_modules"), join(tree, dir, "node_modules"));
    }
    for (const dir of workspacePackages(root).filter((d) => d.startsWith("apps/"))) {
      for (const env of [".env", ".env.local", ".env.test", ".env.test.local"]) {
        link(join(root, dir, env), join(tree, dir, env));
      }
    }

    const testSide = changed.filter(isTestSide);
    const err1 = await applyPaths(root, tree, spec, [...new Set([...testSide, ...tests])]);
    if (err1) return finish(false, err1);
    const build1 = await buildCompiled(tree);
    if (build1) return finish(false, build1);
    const without = await runTests(tree, tests, "without-fix");

    const err2 = await applyPaths(root, tree, spec, product);
    if (err2) return finish(false, err2);
    // Rebuild: the fix may be in a compiled package itself.
    const build2 = await buildCompiled(tree);
    if (build2) return finish(false, build2);
    const withFix = await runTests(tree, tests, "with-fix");

    const v = judge(without, withFix);
    if (!v.ok) console.info(`${without.out}\n${withFix.out}`.slice(-6_000));
    return finish(v.ok, v.reason, {
      without: { ...without, out: undefined },
      withFix: { ...withFix, out: undefined },
    });
  } finally {
    await sh("git", ["worktree", "remove", "--force", tree], root);
    rmSync(tree, { recursive: true, force: true });
    await sh("git", ["worktree", "prune"], root);
  }
}

if (process.argv[1]?.endsWith("repro-proof.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

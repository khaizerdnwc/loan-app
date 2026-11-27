import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The gate must never report success when a stage failed. Found 2026-11-27: on macOS's
 * bash 3.2, an empty array under `set -u` aborted the static stage with "unbound
 * variable", the EXIT trap read $? as 0, printed "✖ static failed" and then
 * "verify: ✅ passed", and the push went through.
 *
 * These tests run the real verify.sh with a stub `pnpm` on PATH, so no tool actually runs.
 * Each case runs under every distinct bash found (PATH's bash and /bin/bash), so a Mac
 * still exercises bash 3.2 even with a newer bash first on PATH. On Linux both are bash 5,
 * where the empty-array half of the bug cannot occur; the fail-closed half is covered
 * everywhere.
 */
const ROOT = resolve(__dirname, "..", "..", "..");
const VERIFY = join(ROOT, "scripts", "verify", "verify.sh");

function which(cmd: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const SHELLS = [
  ...new Set(
    [which("bash"), "/bin/bash"]
      .filter((p): p is string => Boolean(p && existsSync(p)))
      .map((p) => realpathSync(p)),
  ),
];

let stubDir: string;

function run(shell: string, args: string[], failAt: string | null, prelude = "") {
  const script = `${prelude}exec "${shell}" "$0" "$@"`;
  return spawnSync(shell, ["-c", script, VERIFY, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}`, FAIL_AT: failAt ?? "" },
  });
}

beforeEach(() => {
  stubDir = mkdtempSync(join(tmpdir(), "verify-stub-"));
  const pnpm = join(stubDir, "pnpm");
  // Succeeds for every command, except the one named by FAIL_AT.
  writeFileSync(
    pnpm,
    '#!/bin/sh\ncase "$*" in *"$FAIL_AT"*) [ -n "$FAIL_AT" ] && exit 1 ;; esac\nexit 0\n',
  );
  chmodSync(pnpm, 0o755);
});
afterEach(() => rmSync(stubDir, { recursive: true, force: true }));

describe.each(SHELLS)("verify.sh fails closed (%s)", (shell) => {
  it("passes, and says so, only when every step passed", () => {
    const r = run(shell, ["--only", "static"], null);
    expect(r.stdout).toContain("verify: ✅ passed");
    expect(r.stdout).not.toContain("✖");
    expect(r.status).toBe(0);
  });

  it("passes with a non-empty affected filter too", () => {
    const r = run(shell, ["--only", "static", "--affected", "HEAD"], null);
    expect(r.stdout).toContain("affected packages since");
    expect(r.stdout).toContain("verify: ✅ passed");
    expect(r.status).toBe(0);
  });

  it("exits non-zero, and never prints passed, when a step fails", () => {
    const r = run(shell, ["--only", "static"], "typecheck");
    expect(r.stdout).toContain("✖ static");
    expect(r.stdout).not.toContain("✅ passed");
    expect(r.status).not.toBe(0);
  });

  it("fails when the shell exits mid-stage with status 0", () => {
    // A function exported into verify.sh's own shell: `exit 0` in the middle of the static
    // stage leaves with $? = 0 while the stage is still running — the original bug's shape.
    const prelude =
      'pnpm() { case "$*" in *typecheck*) exit 0 ;; esac; command pnpm "$@"; }; export -f pnpm; ';
    const r = run(shell, ["--only", "static"], null, prelude);
    expect(r.stdout).toContain("✖ static");
    expect(r.stdout).not.toContain("✅ passed");
    expect(r.status).not.toBe(0);
  });

  it("fails when the shell exits with status 0 before any stage started", () => {
    // `git rev-parse` for --affected runs after the trap but before the first stage, so
    // CURRENT is empty: only the VERIFY_DONE sentinel can turn this exit into a failure.
    // (The summary is printed into git's own `>/dev/null`, so only the status is visible.)
    const prelude = "git() { exit 0; }; export -f git; ";
    const r = run(shell, ["--only", "static", "--affected", "HEAD"], null, prelude);
    expect(r.stdout).not.toContain("✅ passed");
    expect(r.status).not.toBe(0);
  });

  it("ignores a VERIFY_DONE inherited from the environment", () => {
    const prelude = "export VERIFY_DONE=1; git() { exit 0; }; export -f git; ";
    const r = run(shell, ["--only", "static", "--affected", "HEAD"], null, prelude);
    expect(r.status).not.toBe(0);
  });

  it("never prints a failure and a pass in the same run", () => {
    for (const failAt of [null, "typecheck", "house:check"]) {
      const out = run(shell, ["--only", "static"], failAt).stdout;
      expect(out.includes("✖") && out.includes("✅ passed")).toBe(false);
    }
  });
});

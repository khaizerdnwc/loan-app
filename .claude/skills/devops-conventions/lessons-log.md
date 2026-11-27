# devops lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## devops-20261127-shared-config-in-turbo-global-deps

- 2026-11-27 — First reviewed commit (packages/core). The shared Jest transform
  tools/jest/swc-jest.cjs lives outside every workspace package, and turbo.json had no
  globalDependencies. A change to only that file would have replayed cached test results and
  counted no package as affected for the pre-push `--affected` filter, so the fast gate would
  pass on a broken transform. Found by the devops reviewer; fixed by adding
  `globalDependencies: ["tools/jest/**", "tsconfig.base.json"]` (ADR 0021 R4). Kept as prose
  until a house check can compare config requires with globalDependencies.

## devops-20261127-shell-gate-fails-closed

Gate: check:shell-no-bare-array-expansion, test: tools/review/test/verify-gate.test.ts

- 2026-11-27 — First push of main. On macOS bash 3.2 an empty "${TURBO_FILTER[@]}" under
  set -u aborted the static stage; the EXIT trap read $? as 0 and printed "verify: ✅
  passed", and the push went through. Fixed in cabcddc (fix(gate)): ${a[@]+"${a[@]}"}
  expansion, a CURRENT guard and a VERIFY_DONE sentinel in cleanup(), and the --affected git
  calls moved after the trap. tools/review/test/verify-gate.test.ts proves each guard. The
  devops reviewer proposed a house check (trap scripts reset a sentinel; no bare array
  expansion in scripts/**/*.sh) — candidate, not yet written.
- 2026-11-27 — Repeat: the semgrep `roots` array added in the engine commit used a bare
  "${roots[@]}" again (devops reviewer). Prose failed within the hour, so it was promoted to
  check:shell-no-bare-array-expansion, and every expansion in verify.sh moved to the safe form.

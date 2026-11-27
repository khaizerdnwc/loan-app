/**
 * A `fix:` must say how its bug was reproduced (ADR 0017): a test that fails without the
 * fix, or why no test can. The trailer is checked here; the test itself is proved by
 * scripts/repro-commit-check.sh (lefthook commit-msg), which runs it without and with the
 * fix.
 *
 *   Repro-Test: apps/web/src/features/x/__tests__/y.test.ts
 *   Repro: not testable — <reason, e.g. Safari-only layout glitch>
 */
const REPRO_TEST = /^Repro-Test:[ \t]*\S+/m;
const REPRO_NOT_TESTABLE = /^Repro:[ \t]*not testable[ \t]*(?:—|–|--?)[ \t]*(\S.{9,})$/m;

/** @param {{ type: string | null, raw: string }} commit */
export function fixNeedsRepro(commit) {
  if (commit.type !== "fix") return [true];
  if (REPRO_TEST.test(commit.raw)) return [true];
  if (REPRO_NOT_TESTABLE.test(commit.raw)) return [true];
  if (/^Repro:/m.test(commit.raw)) {
    return [false, "`Repro: not testable — <reason>` needs a reason of at least 10 characters"];
  }
  return [
    false,
    "a fix: needs a `Repro-Test: <test file>` trailer (a test that fails without the fix), " +
      "or `Repro: not testable — <reason>`",
  ];
}

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [{ rules: { "fix-needs-repro": fixNeedsRepro } }],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "security",
      ],
    ],
    "subject-case": [0],
    "body-max-line-length": [0],
    "fix-needs-repro": [2, "always"],
  },
};

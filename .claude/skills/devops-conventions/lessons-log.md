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

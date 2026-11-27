# architecture lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## architecture-20261127-depcruise-sees-workspace-edges

Gate: check:depcruise-paths-cover-packages

- 2026-11-27 — Adding the decision-engine-is-pure rule (architecture review of the engine
  commit). A deliberate `@loan/contracts` import in the engine was NOT reported: every
  `@loan/*` import resolved through node_modules to packages/*/dist, and both were in the
  exclude list, so the edge vanished — and with it every cross-package direction rule since
  the bootstrap. Fixed by resolving workspace packages to src via tsconfig.depcruise.json
  and dropping node_modules from exclude; the deliberate violation is now refused. Prose
  until a check asserts a known edge (engine → @loan/core) appears in the graph.

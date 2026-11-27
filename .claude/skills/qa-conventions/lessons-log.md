# qa lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## qa-20261127-band-edges-must-be-reachable

Gate: test: packages/base/test/decisioning/decide.test.ts

- 2026-11-27 — Engine review. SC-PL-1 scores are 307 plus multiples of 5, so no persona can
  land on 600/700 or a grade cut-off; the band and grade logic was untested at its edges and
  `>=` → `>` would pass. Fixed by exporting bandFor/gradeFor and testing every edge directly
  (599/600, 699/700, 559/560, 739/740), plus Nico pinned at 602 C.

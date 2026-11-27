---
name: house-rule-authoring
description: How to turn a lesson into a house ESLint rule in this repo — the rule file, registering it, the RuleTester test, and verifying it before it counts. Load when adding or changing anything under packages/eslint-house/ or the root eslint.config.js, or when a lesson needs to become a deterministic gate.
paths:
  - packages/eslint-house/**
  - eslint.config.js
---

# Writing a house ESLint rule

A lesson that can be expressed as lint becomes a rule **in the same turn**, set to
`error`, without asking. That is the whole point: the user should never have to give
the same correction twice. A lesson that cannot be expressed as lint stays prose in
`lessons.md` — say so explicitly rather than writing a rule that almost works.

**Lint-shaped** means a checker can decide it from one file's path and syntax tree:
a forbidden import, a missing wrapper, a banned JSX prop, a required export, a call
whose arguments are wrong. **Not lint-shaped** means it needs runtime, the database,
cross-file knowledge, or human judgment: "this flow is confusing", "this query is
slow", "this shell doesn't match its page".

## 1. The rule file

`packages/eslint-house/src/rules/<kebab-name>.js` — plain ESM, no TypeScript. One package
holds every house rule and the one root `eslint.config.js` loads it, so the on-edit hook,
preflight, the pre-push gate and the PR all run the same rules. Model it on
[`require-roles-on-controller-handler.js`](../../../packages/eslint-house/src/rules/require-roles-on-controller-handler.js)
(path gate, then AST) or
[`no-float-money.js`](../../../packages/eslint-house/src/rules/no-float-money.js).

```js
/**
 * @fileoverview <One line: what is forbidden and why it bit us.>
 *
 * <A short paragraph of the real consequence — the duplicate booking, the centavo drift,
 * the unauthorized approval. Cite the rule it enforces (AGENTS.md, an ADR, an Engineering
 * Standard).>
 *
 * Opt out where the rule genuinely does not apply:
 *   // eslint-disable-next-line house/<kebab-name> -- <why>
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "<one sentence, imperative>",
      owner: "<security|ui-ux|data|architecture|qa|devops>",
      lesson: "<the lesson id this rule gates, if any>",
    },
    schema: [],
    messages: {
      <messageId>:
        "<What is wrong.> <What to do instead, naming the real export and module.> " +
        "<How to opt out, if opting out is ever legitimate.>",
    },
  },
  create(context) {
    // Repo-relative with "/" separators, anchored on this package — not on process.cwd().
    const rel = repoRelative(filenameOf(context));

    // Gate on the path FIRST — cheapest, and it is what keeps the rule from firing across
    // the whole repo. Test the START of `rel`, never `includes`.
    if (!isServerCode(rel)) return {};

    return {
      // AST selectors. Collect across the file, decide in Program:exit when the finding
      // depends on the absence of something.
      ImportDeclaration(node) {
        /* ... context.report({ node, messageId: "<messageId>" }) ... */
      },
    };
  },
};
```

Path helpers in [`src/_app-path.js`](../../../packages/eslint-house/src/_app-path.js):
`repoRelative(filename)`, `isServerCode(rel)` (apps/api/src, packages/{base,core,contracts}/src),
`isWebCode(rel)` (apps/backoffice/src, packages/ui/src), `isProductCode(rel)` (any app or
package src), `isTestFile(rel)`, and `appRelative(filename)` (package-relative `src/…`, used by
the rules ported from nxlvl).

Rules of thumb that keep these rules from becoming noise:

- **Gate on the path before anything else.** A rule that inspects every file is a
  rule that will eventually fire somewhere silly.
- **Anchor every path test.** Use `repoRelative(filename)` and the scope helpers from
  `../_app-path.js`, with `startsWith` or an anchored regex for directories. In nxlvl,
  `filename.includes("scripts/")` exempted any folder merely named `scripts` and was copied
  into nine rules before anyone noticed. `process.cwd()` is no better: it moves with whoever
  runs ESLint.
- **Probe your own rule before calling it a gate.** Try the other spellings of the same
  mistake: a re-export (`export … from`), `import()`, a value built into a `const` first,
  string concatenation, a look-alike helper name from another module. The security
  reviewer's first pass on a new rule found six bypasses; add a RuleTester case for each.
- **Report on the smallest node that localises the problem**, so the error points at
  the line the developer has to change.
- **The message must say what to do instead**, naming the real export and module —
  not just what is forbidden. Developers read the message, not the rule.
- **Absence needs `Program:exit`.** Collect state in the visitors, decide at the end.
- **Autofix only when the rewrite is total and local**: exactly one correct fix, inside the
  flagged node, with no choice for a human to make (`meta.fixable: "code"` + `fix(fixer)`).
  When a human must pick, offer `meta.hasSuggestions` instead. A wrong autofix is worse
  than an error. A fixable rule needs an `output` on every invalid case, and `output: null`
  on each case the fix must leave alone. `pnpm review:preflight` applies house fixes to the
  changed files automatically.
- **Not AST-shaped?** SQL, JSON, a Dockerfile, a Markdown table, or anything spanning files is
  a check in `tools/review/src/checks/`, not a rule (see the `/lesson` skill).

## 2. Register it

Two files, both mechanical:

- [`packages/eslint-house/src/index.js`](../../../packages/eslint-house/src/index.js) — add the
  `import`, the entry in the `rules` map, and a line in the header comment
  (`*   - <name> : <what it blocks>`). That header is the canonical list of house rules; other
  docs point at it. `pnpm house:check` (`check:house-rule-parity`) fails if a rule file is
  missing from the header, the rules map, the root `eslint.config.js`, or a
  `ruleTester.run("<name>", …)` with at least one valid and one invalid case, so none of these
  steps is optional.
- [`eslint.config.js`](../../../eslint.config.js) at the repo root — add
  `"house/<kebab-name>": "error"` in the rules block, under its owning role's comment.

## 3. Test it

Tests live in `packages/eslint-house/test/` and run under Vitest. Append to
`house-rules.test.ts` (or a `<role>` file with the same header). Filenames are **absolute**,
built from `REPO_ROOT`, so the path gates see real locations:

```ts
import { join } from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import { REPO_ROOT } from "../src/_app-path.js";
import myRule from "../src/rules/my-rule.js";

// ESLint's RuleTester drives the host runner. Vitest runs with globals: false.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    // @ts-expect-error — tseslint.parser satisfies the flat-config Parser shape.
    parser: tseslint.parser,
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});
const at = (rel: string) => join(REPO_ROOT, rel);

ruleTester.run("my-rule", myRule, {
  valid: [
    { filename: at("packages/base/src/booking/booking.service.ts"), code: `/* the correct shape */` },
    { filename: at("apps/backoffice/src/app/page.tsx"), code: `/* outside the path gate */` },
  ],
  invalid: [
    {
      filename: at("packages/base/src/booking/booking.service.ts"),
      code: `/* the shape that bit us */`,
      errors: [{ messageId: "<messageId>" }],
    },
  ],
});
```

Decorators parse only inside a class (`class E { @Column(...) x; }`), not at the top level.
Minimum bar: **two valid cases** — one correct usage and one file outside the path gate — and
**one invalid case** asserting the `messageId`. If the rule has an opt-out, add a valid case
proving the opt-out works.

## 4. Verify before it counts

The rule is not "added" until both of these pass:

```bash
pnpm --filter @loan/eslint-house test
pnpm lint && pnpm house:check
```

The second one is the important one: it runs the new rule across the whole repo and
tells you what the codebase already violates.

- **Zero pre-existing violations** → register as `"error"`. Done.
- **One to ten** → still `"error"`. List every violation in your report with
  `file:line` so the main session fixes them in the same change. You do not fix
  them yourself.
- **More than ten** → register as `"warn"` instead, and record
  `pending promotion (N existing sites)` in the lesson's `lessons-log.md` section. One lesson must
  never turn the whole build red. Say so plainly in your report.

If `pnpm lint` crashes on the new rule, the rule is wrong — fix it or delete
it. Never leave a broken rule registered.

## 5. Record it

A gated lesson is no longer loaded (ADR 0016). Delete its line from the role's
`lessons.md`, and add `Gate: house/<rule>` directly under its `## <id>` heading in
`lessons-log.md`. The rule's message is now what people read; the log keeps the why, one
`pnpm lessons show house/<rule>` away. Run `pnpm lessons check`.

## When it is not lint-shaped

Say so, say why, and name the nearest deterministic alternative so the main session
can pick it up:

- **Cross-file-shaped** (a unique constraint the entity declares but no migration creates,
  an acceptance criterion naming a test that does not exist) → a check in
  `tools/review/src/checks/<id>.ts`, which `pnpm house:check` runs in preflight and CI.
- **Behavioural** (an endpoint that must refuse the maker as checker) → a Jest integration
  case in `apps/api/test/`.
- **Operational** (an env var that must exist in the dev environment) → a runbook step.
- **Visual or experiential** → it stays prose. Some things only a reviewer catches.

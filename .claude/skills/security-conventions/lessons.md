# Security lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role security`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [security-20261127-gitleaks-allowlist-literal-must-be-anchored] paths: .gitleaks.toml · shape: check-candidate · Anchor an allowlist regex for one published value (`^…$`), or it waives every secret containing it. Check: new `regexes` entries are `^…$` and gitleaks still passes.
- [security-20261127-throttle-key-needs-a-per-source-cap] paths: apps/api/src/throttler.guard.ts, apps/api/src/app.module.ts, packages/base/src/**/*.controller.ts · shape: test-candidate · A tracker keyed on a client-chosen value needs a per-address limit too. Check: distinct usernames from one address reach 429.

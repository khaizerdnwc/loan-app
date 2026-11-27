# Security lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role security`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [security-20261128-compliance-findings-stay-out-of-case-history] paths: packages/base/src/compliance/*.ts · shape: test-candidate · Compliance notes and match details go to the audit log, not case activity details every case viewer reads. Check: a loan officer's case activity has no notes or matchedList.
- [security-20261127-precondition-rechecked-under-the-lock] paths: packages/base/src/cases/*.service.ts · shape: test-candidate · A gate checked before an out-of-transaction provider call is re-checked after lockOrFail, or its writer bumps the case version. Check: the gate is read again inside tx.run.
- [security-20261127-gitleaks-allowlist-literal-must-be-anchored] paths: .gitleaks.toml · shape: check-candidate · Anchor an allowlist regex for one published value (`^…$`), or it waives every secret containing it. Check: new `regexes` entries are `^…$` and gitleaks still passes.
- [security-20261127-throttle-key-needs-a-per-source-cap] paths: apps/api/src/throttler.guard.ts, apps/api/src/app.module.ts, packages/base/src/**/*.controller.ts · shape: test-candidate · A tracker keyed on a client-chosen value needs a per-address limit too. Check: distinct usernames from one address reach 429.

# UI and UX lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role ui-ux`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [ui-ux-20261128-unavailable-says-why] paths: apps/backoffice/src/** · shape: test-candidate · A value a provider could not supply says why and what still works, and no caption claims the provider supplied it. Check: every `=== null ? "Unavailable"` sits next to a sentence naming the provider and the effect.
- [ui-ux-20261127-dialog-follows-refreshed-case] paths: apps/backoffice/src/components/case/** · shape: test-candidate · A dialog left open after a refusal re-reads the case follows the new status, or closes. Check: no dialog still offers an action the refreshed case does not list.

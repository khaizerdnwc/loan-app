# UI and UX lessons

Ungated lessons only, one per line, newest first. Load only the ones for your files: `pnpm lessons for <files> --role ui-ux`. Full story: `pnpm lessons show <id>`. Enforced lessons are not listed; the rule's message is the lesson.

- [ui-ux-20261128-no-figure-below-minimum] paths: apps/backoffice/src/** · shape: test-candidate · A statistic computed on fewer cases than its minimum is not shown as a figure beside its thresholds. Check: under an "insufficient data" status, the value reads "not computed" with the counts.
- [ui-ux-20261128-engine-figure-says-basis] paths: apps/backoffice/src/components/case/** · shape: test-candidate · An engine figure is named as the engine's, not with a staff action's word, says it is indicative, and puts its edge value in words. Check: no "Recommended …" engine figure; a zero reads as a sentence.
- [ui-ux-20261128-unavailable-says-why] paths: apps/backoffice/src/** · shape: test-candidate · A value a provider could not supply says why and what still works, and no caption claims the provider supplied it. Check: every `=== null ? "Unavailable"` sits next to a sentence naming the provider and the effect.
- [ui-ux-20261128-dialog-offers-only-accepted-choices] paths: apps/backoffice/src/components/case/** · shape: test-candidate · A dialog offers only the choices the API accepts for this case, and defaults to one. Check: no dialog select defaults to or enables a choice the API refuses here (knockout: decline only).
- [ui-ux-20261127-dialog-follows-refreshed-case] paths: apps/backoffice/src/components/case/**, apps/backoffice/src/components/compliance/** · shape: test-candidate · A dialog left open after a refusal follows the re-read record, or closes. Check: no dialog offers an action the refreshed record lacks.

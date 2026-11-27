# ui-ux lessons — log

Full narratives, newest first. **Not loaded** by any skill or agent: the loaded, path-tagged
one-liners are in `lessons.md`. Read one entry with `pnpm lessons show <id>`, or every entry a
rule enforces with `pnpm lessons show house/<rule>`. A `Gate:` line means a machine enforces it.

## ui-ux-20261128-unavailable-says-why

When a provider could not answer and a field is shown as "Unavailable", the same card says which provider could not answer and what that means for the case (it still proceeds; the figure is quoted again later, or never). Why: on the approved-terms card (BK/#13, 2026-11-28) the monthly instalment read "Unavailable" while the caption under it still said "instalment quoted by core banking (simulated)" — the screen contradicted itself and an officer could not tell whether the offer or the booking was blocked (Engineering Standard 6: understandable pending states). The indicative-repayment box on the same change did it right: "Core banking could not quote it just now. This does not affect saving or submitting the application." Nearest deterministic alternative: a component test that renders the panel with the value null and asserts the explanatory sentence and the absence of the "quoted by" caption.

## ui-ux-20261127-dialog-follows-refreshed-case

When a refused action re-reads the case (CHANGES_ON_REFUSAL in actions-panel.tsx) and the confirmation dialog stays open to show the error, the dialog must follow the refreshed case: re-title it to the action the new status lists (Approve booking becomes Retry booking on BOOKING_FAILED) or close it and show the error inline on the panel. Why: the header says "Booking failed" and the panel offers "Retry booking" while the still-open dialog asks "Approve this booking?" with an "Approve booking" button; the next click is in fact a retry under a different name, and the supervisor confirms something the screen no longer describes (Engineering Standard 6: understandable states, confirmation states what will happen). Found reviewing the B-5 re-read change on 2026-11-27. Nearest deterministic alternative: a Vitest case that re-renders ActionsPanel with the refreshed detail and asserts the dialog's confirm label.

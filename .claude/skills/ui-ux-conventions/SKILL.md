---
name: ui-ux-conventions
description: What this repo's UI rules are — prototype-derived tokens in packages/ui, the screen shell, decision and state presentation, confirmation dialogs, RFC 9457 errors shown readably, Simulated labels, formatPeso and accessibility — plus the lint rules that enforce each. Load when editing backoffice .tsx/.css or packages/ui.
paths:
  - apps/backoffice/src/**/*.tsx
  - apps/backoffice/src/**/*.css
  - packages/ui/**
---

# UI and UX conventions

This file is the map; the long form is in `AGENTS.md`, `docs/ARCHITECTURE.md` and the ADRs
under `docs/DECISIONS/`. The lessons this repo has paid for are one command away (below).

## Look

- The look is copied from the prototype and will be restyled later, so **every colour, radius,
  font and shadow is a token** in `packages/ui` (Tailwind 4 `@theme`): ink, slate, gold accent,
  green/red/blue states, Manrope for text, JetBrains Mono for ids and amounts. No literal
  colours in components (`house/no-raw-colour`).
- Shell: dark 252px sidebar with grouped navigation and count badges, white sticky top bar
  with breadcrumb and role button; the sidebar becomes a drawer under 860px.

## Clarity of outcomes

- Each outcome has one consistent pill and wording: *Auto-approve*, *Refer*, *Auto-decline*,
  plus the case stage (Review, Approval, Offer, Booking, Pending checker, Booking failed,
  Disbursed, Declined).
- A referred or declined case shows its reason codes in plain words and the referral trigger.
- Pending states say what the case is waiting for and who acts next.
- Anything produced by a simulated service carries a visible *Simulated* label.

## Actions and errors

- Every consequential action — submit, recommend, approve, decline, submit booking, check
  booking, retry, change a failure mode — opens a confirmation dialog that states what will
  happen (amount, tenor, who is affected) before it runs.
- API errors are RFC 9457 problem details; show `detail` in words a loan officer understands,
  inline where the action was, never a raw status code or JSON.
- Loading, empty and error states exist for every screen that fetches.

## Money and accessibility

- Amounts are shown only through `formatPeso()` (`house/money-through-formatter`), right-aligned
  in tables, monospaced.
- `eslint-plugin-jsx-a11y` (recommended) runs on every .tsx; plus the ported nxlvl rules
  `no-title-on-disabled-control`, `require-label-in-name`, `no-ring-color-without-width`,
  `text-size-before-leading`. Visible focus, labels on every input, keyboard-reachable dialogs.

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role ui-ux
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).

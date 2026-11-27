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

- The look is copied from the team prototype (its final "Retail Back Office" theme) and will be
  restyled later, so **every colour, radius, font and shadow is a token** in the backoffice
  `globals.css` `@theme`: ink, mist (slate), gold accent, ok/bad/info states, three border
  weights (`line-soft` dividers, `line` cards, `line-strong` buttons and fields), Manrope for
  text, JetBrains Mono for identifiers only. No literal colours in components
  (`house/no-raw-colour`).
- **A new screen copies its prototype screen** where one exists, and is built only from the
  parts below. Where we differ from the prototype on purpose, docs/ASSUMPTIONS.md says why;
  the screen-by-screen audit is docs/ui-parity.md.
- Shell: dark 252px sidebar with grouped navigation and count badges (shown only above zero),
  white sticky top bar with breadcrumb and role chip; under 860px the sidebar is a drawer
  opened by an icon button named "Menu".

## Parts (packages/ui) — use these, never re-style a native element

| Part | Use it for |
|---|---|
| `PageHeader` (app shell) | Every page: icon tile, title, description, actions on the right |
| `useShellCrumb(reference)` (app shell) | A detail page names its record in the top bar's breadcrumb ("… / All applications / APP-1002") |
| `Card` (`title`, `aside`, `flush`) | Every panel: header bar over a divider, then the body; `flush` for a table or list edge to edge |
| `Table` (`clickableRows`) + `ROW_LINK` | Every list of records. A list of records the user opens sets `clickableRows` and puts `{...ROW_LINK}` on the row's one real `<Link>`: the whole row opens it, hover and focus tint the row, Tab and Enter use the link |
| `EmptyState` | Nothing to show: a bold line and an optional hint (a string `empty` on Table becomes one) |
| `Button` / `buttonClass` | `primary` (dark ink; at most one per card or dialog), `secondary` (every other action), `danger` (decline, refuse, failure modes), `ghost` (low emphasis); `size="sm"` for row actions and card headers. `accent` is the same look as primary — use `primary`. Links that look like buttons use `buttonClass` |
| `Field` + `Input` / `Select` / `Textarea`, `Checkbox`, `FormGrid`, `FormStack` | Every form control |
| `Pill`, `StagePill`, `OutcomePill` | Every status, stage, outcome or flag — one shape, five tones |
| `Callout` (`tone`, `lead`, `alert`) | Outcome banners, referral reasons, waiting states and errors: a bordered tinted box with a bold lead-in; `alert` for a failure the user just caused |
| `KeyValues` | A record's facts: label over value in auto-fill columns; `mono` only for identifiers |
| `StatCard`, `SegmentedFilter` | Queue figures; filtering a list |
| `StageBar`, `ScoreBand`, `GradeTile`, `Avatar`, `Icon`, `SimulatedLabel` | As named |
| `Modal`, `ConfirmDialog` | Every dialog; footer buttons secondary first, the confirming one last |
| `useToast` | The result of an action, top right |
| `LoadState` (backoffice) | Loading and error-with-retry for every fetching screen |

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

- Amounts are shown only through `formatPeso()` (`house/money-through-formatter`), in the body
  font. A sentence the API wrote (activity summaries, rule values, problem details, toasts) is
  shown through `formatAmountsInText()`, so "₱20000.00" reads "₱20,000.00" like everything
  else; `errorMessage()`, `ConfirmDialog` errors and toasts already do it. Values stacked in a column (tables, score contributions, the schedule) are
  right-aligned with `tabular-nums`; a single value in a `<dl>` keeps proportional figures.
  Monospace is only for identifiers: references, IDs, account numbers, booking keys, reason
  codes and rule-set versions.
- Text sizes come only from the type scale in `globals.css` `@theme`: `text-2xs` (11px
  labels, table headings), `text-xs` (12), `text-sm` (13), `text-base` (14, body and
  controls), `text-title` (15, card titles), `text-lg` (18), `text-stat` (28), `text-display`
  (32, page titles). No `text-[…px]` (`house/no-arbitrary-text-size`).
- Forms are built only from `Field` with `Input`, `Select` or `Textarea`, laid out with
  `FormGrid` (side by side) or `FormStack` (stacked); never a native control with its own
  classes. Controls and buttons render at the same height.
- `eslint-plugin-jsx-a11y` (recommended) runs on every .tsx; plus the ported nxlvl rules
  `no-title-on-disabled-control`, `require-label-in-name`, `no-ring-color-without-width`,
  `text-size-before-leading`. Visible focus, labels on every input, keyboard-reachable dialogs.
- Every interactive part has its states from the shared parts: hover, keyboard focus (the
  solid gold-700 ring, never the prototype's faint glow), active, disabled (one sunken look;
  a blocked action shows its reason under it), empty, loading and error.

## Lessons

Do not read `lessons.md` whole. Load only the lessons for the files in hand:

```bash
pnpm lessons for <files you are editing or reviewing> --role ui-ux
```

Each line is an instruction with a `Check:`; follow it. `pnpm lessons show <id>` prints the
full story when the reasoning is in question. Lessons a lint rule, check or test enforces are
not listed at all — the rule's message is the lesson, and `pnpm lessons show house/<rule>` has
the why. The grammar and the budget are in the `/lesson` skill (ADR 0016).

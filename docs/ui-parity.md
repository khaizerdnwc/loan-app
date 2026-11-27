# UI parity with the team prototype

The prototype (the single-HTML "WhiteBank Lending Prototype" artifact, final "Retail Back
Office" theme) is the reference for every screen. This note lists each difference found when
our screens were compared with their prototype screens, and what happened to it. Screenshots of
both, at 1440px and 390px wide, were taken with Playwright for the audit (prototype rendered
from its raw HTML; ours against a seeded database); they are working files, not kept in the
repository.

Screens compared: work queue (officer, approver, loan operations), all applications, new
application, case detail (draft, review, approval, pending checker, disbursed, declined), the
decision panel and decision record, the recommend, approve, decline and approve-booking
dialogs, simulated services (against the prototype's Integrations screen), and sign-in
(against the prototype's role picker; the prototype has no sign-in page).

Status: **fixed** (in this change), **kept** (a deliberate difference, recorded in
docs/ASSUMPTIONS.md), **later** (not in this batch; who owns it).

The rules that came out of this, and the component list, are in
`.claude/skills/ui-ux-conventions/SKILL.md`.

## Shared parts (packages/ui) — every screen inherits these

| # | Area | Prototype | Ours before | Status |
|---|---|---|---|---|
| 1 | Table rows | Whole row clickable (`tr.cl`): pointer cursor, row tint on hover, Enter opens it | Only the applicant name was a link; no row hover | **fixed** — `Table clickableRows`: a click anywhere in the row follows the row's one real link (`ROW_LINK`); row tints on hover and while its link has focus; buttons in a row, modified clicks and text selections are left alone; no extra tab stop |
| 2 | Table cells | 13px cells, 13×16 padding, soft row dividers, header 11px uppercase on a tint | Same header; 12×16 cells, full-strength dividers | **fixed** |
| 3 | Empty table | `.empty`: bold line, optional hint | One muted sentence in a dashed box | **fixed** — `EmptyState` |
| 4 | Buttons | One hierarchy: `.btn` white with the strong border, `.pri` dark ink, `.dan` solid red, `.sm`, `.ghost`; disabled is a sunken grey | Primary/accent ink, secondary with the light border, danger hover went *lighter* (white on #db4a52 is 3.9:1, under AA), disabled was 50% opacity, no small size | **fixed** — strong border token, danger hover darkens (`bad-800`, 7.3:1), one disabled look, `size="sm"` |
| 5 | Form fields | Inputs with the strong border (`--border-x`), radius 12, uppercase 10.5px labels | Light border | **fixed** (label style already matched) |
| 6 | Pills | Lightest tint (050) with a 1px inset ring one step darker, 12px semibold | 100 tint, no ring | **fixed** — one `Pill`; every stage, outcome and flag uses it |
| 7 | Cards | Header bar with a soft divider under it, then the body | Title and body in one padded block, no divider | **fixed** — `Card` header bar; `flush` for edge-to-edge content |
| 8 | Outcome and message boxes (`.trig`) | Bordered tinted box with a bold lead-in, per tone | Borderless tinted boxes, each screen its own classes | **fixed** — `Callout`, used for outcome banners (neutral for a withdrawn or expired case), "Referred because", declines, failed bookings, load errors, sign-in and dialog errors |
| 9 | Facts (`dl.kv`) | Label-over-value fields in auto-fill columns, uppercase labels, 14px values | Three different layouts: two-column right-aligned (Applicant), small-label grid (terms, loan account, new application) | **fixed** — `KeyValues` everywhere, including the Withdrawal card |
| 10 | Stage bar | Done grey, current dark ink, a stop in red, ahead sunken; left-aligned 11px | Done green, current gold, centred | **fixed** (ahead text a shade darker for AA: **kept**). A withdrawn or expired case stops at the stage it closed from as a white step with a strong ring — closed, not failed (the prototype draws Withdrawn in red: **kept** neutral, matching the neutral Withdrawn/Expired pills). Under 860px the steps wrap onto a second row instead of scrolling (the prototype scrolls, which left the current step off-screen at 390px) |
| 11 | Score scale | Pale red / gold / green zones, dark 3px marker | Saturated zones | **fixed** |
| 12 | Rule results | Pass/fail mark in a tinted circle | Bare coloured mark | **fixed** |
| 13 | Activity history (`.hist`) | Dot per event on a thin line, who · what, time below | Gold left border | **fixed**; stage-change pills no longer leave the arrow on its own line |
| 14 | Modal | Title 18px extrabold, body, footer bar over a divider, radius 16 | One padded block, no footer divider, radius 14 | **fixed** |
| 15 | Toast | Dark ink notice with a coloured left edge, top right | Tinted notice | **fixed** |
| 16 | Amounts | `peso()` everywhere | `formatPeso` on our own fields, but sentences written by the API showed "₱20000.00" (activity history, rule value "limit 300000.00", approval-limit refusal, booking summary) | **fixed** — `formatAmountsInText` in the timeline, rule values, toasts, dialog errors, `errorMessage()` and blocked-action reasons; stored history is fixed too because the sentence is formatted when shown |
| 17 | Monospace | Ids, model and rule-set names; also rule values and timings | Ids — and the whole case crumb ("Applications / APP-1001") | **fixed** — only the reference in the crumb is monospace; rule values stay in the body font (**kept**) |
| 18 | Amount alignment | Left-aligned in tables | Right-aligned with tabular figures | **kept** (our rule: stacked amounts line up) |
| 19 | Focus ring | 3px glow at 40% gold | Solid 2px gold-700 outline | **kept** (the glow is under 3:1 non-text contrast) |
| 20 | Checkbox accent | Gold | Ink | **kept** (gold-600 on white is under 3:1) |

## Shell (apps/backoffice/src/components/app-shell.tsx)

| # | Prototype | Ours before | Status |
|---|---|---|---|
| 21 | Count badge only when there is something to do | A gold "0" badge on an empty queue | **fixed** |
| 22 | Menu button is a 34px icon button (hamburger) | A "Menu" text button | **fixed** — icon button named "Menu" |
| 23 | "Run simulation" starts a guided demo | Our button links to Simulated services, and showed on that page too | **fixed** (hidden on the page it links to); a guided demo is not built |
| 24 | Breadcrumb on a case: "Applications / All applications / APP-1042" | "All applications / Case" | **fixed** — on a case the top bar reads "<group> / All applications (a link) / <reference>"; the case page names its reference through `useShellCrumb`, and the bar says "Case" until it has loaded. Below 860px, where the top bar hides its crumb, the case header shows "All applications / <reference>" instead |
| 25 | Brand mark, search, bank logo, environment chip, notifications bell | Not present | **later / deferred** — no search or notifications in this release (docs/ACCEPTANCE.md, Deferred) |

## Screens

| # | Screen | Difference | Status |
|---|---|---|---|
| 26 | Queue | Prototype has tabs My queue / Team queue / Unassigned and an SLA column | **later** — no team queue, assignment or SLA in this release; our segmented filter by stage uses the same look |
| 27 | Queue (390) | Prototype KPI cards follow its 4-column grid (2 under 1100px, 1 under 520px); ours were capped at 280px | **fixed** — the same grid, cards fill their column |
| 28 | All applications | Prototype tabs In progress / Closed / All with counts, and a "New assisted application" action | **fixed** — the same three filters with counts (closed = declined, disbursed, withdrawn, expired), opening on In progress, and "New application" for the loan officer; the prototype's Reason and SLA columns are not built (no SLA in this release) |
| 29 | New application | Prototype: "Consent" card title, Submit and Save draft side by side; ours "3 · Consent" and stacked full-width buttons | **fixed** |
| 30 | New application | Prototype captures a new customer (name, age, employer, income) and documents; we pick a seeded applicant | **kept** (scope: synthetic personas only) |
| 31 | Case header | Prototype: crumb, icon tile, name, a row of facts; ours had the crumb in monospace, no tile, one run-on line | **fixed** |
| 32 | Case | Prototype: credit bureau, relationship, checks and documents cards; not built | **later** (data not in the API) |
| 33 | Next action card | Prototype: buttons inline, primary first, tools (Withdraw, Reassign) under a divider; ours full-width stacked | **fixed** — steps inline (one primary), blocked reasons listed under them (still linked to each button), Withdraw apart under a divider in the small size |
| 34 | Decision record | Prototype: a diff-style monospace record; ours a monospace key/value list | **kept** (a technical record of identifiers and versions) |
| 35 | Approve dialog | Prototype states the monthly repayment; ours states amount, tenor and who receives the offer | **later** (needs the instalment quote before approval) |
| 36 | Simulated services | Prototype Integrations: one table of providers with status and an action; ours a card per service with a failure-mode select | **kept** (our screen sets modes); "(simulated)" in each title plus the Simulated chip is repetitive — **later** |
| 37 | Sign-in | No prototype screen (role picker) | sign-in uses the shared Card, Field, Button and Callout |

## States checked on every screen

Hover (rows, buttons, nav), keyboard focus (rows via their link, buttons, fields, dialogs),
active (nav item, segmented filter, current stage), disabled (one look; blocked actions show
their reason under the button), empty (EmptyState), loading ("Loading…" card) and error
(`Callout` with Try again) all come from the shared parts above.

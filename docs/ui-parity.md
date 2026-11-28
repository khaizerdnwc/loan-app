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
| 26 | Queue | Prototype has a Reason column, tabs My queue / Team queue / Unassigned, and SLA and Owner columns | **partly fixed** — the Reason column is built (the first referral trigger, or an automatic decline's first reason, from `CaseSummary.reason`) and shows on every case table; team queue, assignment, SLA and owner are **later** (no assignment or SLA data in this release) |
| 27 | Queue (390) | Prototype KPI cards follow its 4-column grid (2 under 1100px, 1 under 520px); ours were capped at 280px | **fixed** — the same grid, cards fill their column |
| 28 | All applications | Prototype tabs In progress / Closed / All with counts, and a "New assisted application" action | **fixed** — the same three filters with counts (closed = declined, disbursed, withdrawn, expired), opening on In progress, and "New application" for the loan officer; the prototype's Reason and SLA columns are not built (no SLA in this release) |
| 29 | New application | Prototype: "Consent" card title, Submit and Save draft side by side; ours "3 · Consent" and stacked full-width buttons | **fixed** |
| 30 | New application | Prototype captures a new customer (name, age, employer, income) and documents; we pick a seeded applicant | **kept** (scope: synthetic personas only) |
| 31 | Case header | Prototype: crumb, icon tile, name, a row of facts; ours had the crumb in monospace, no tile, one run-on line | **fixed** |
| 32 | Case | Prototype: credit bureau, relationship, checks and documents cards; not built | **later** (data not in the API) |
| 33 | Next action card | Prototype: buttons inline, primary first, tools (Withdraw, Reassign) under a divider; ours full-width stacked | **fixed** — steps inline (one primary), blocked reasons listed under them (still linked to each button), Withdraw apart under a divider in the small size |
| 34 | Decision record | Prototype: a diff-style monospace record; ours a monospace key/value list | **kept** (a technical record of identifiers and versions) |
| 35 | Approve dialog | Prototype states the monthly repayment ("₱6,920.00 at grade C, calculated by core"); ours stated amount, tenor and who receives the offer | **fixed** — the dialog states core banking's quote for the recommended terms at the case's grade and rate (`CaseDetail.proposedRepayment`, the same instalment the approval then records); when core cannot quote it, it says so and that approving does not depend on it |
| 36 | Simulated services | Prototype Integrations: one table of providers with status and an action; ours a card per service with a failure-mode select | **kept** (our screen sets modes); "(simulated)" in each title plus the Simulated chip is repetitive — **later** |
| 37 | Sign-in | No prototype screen (role picker) | sign-in uses the shared Card, Field, Button and Callout |

## Compliance screens (lane B: AML escalations, audit log)

| # | Screen | Difference | Status |
|---|---|---|---|
| 38 | AML escalations list | Prototype rows are plain (an action button per row); our rule is that a list of records the user opens has clickable rows. Ours: only the name opened it | **fixed** — rows open the escalation through the name link (`ROW_LINK`); the case reference stays its own link |
| 39 | AML escalations list | The Open / All filter showed no counts and was not kept in the URL | **fixed** — one list (`view=all`) gives both filters their counts (open = not closed, as the API filters); the choice is kept in the URL (`?view=all`), so Back restores it |
| 40 | AML escalation detail | Its own crumb ("AML escalations / APP-…") showed beside the top bar's "Compliance / AML escalations" at any width | **fixed** — the top bar reads "Compliance / AML escalations (a link) / APP-…" for any detail page under a nav item; the header crumb shows only below 860px, like the case page |
| 41 | AML escalation detail | "Open case APP-…" was an underlined text link beside the title | **fixed** — a secondary button, like the case page's "Decision record" |
| 42 | Audit log | "What happened" showed server sentences with raw amounts ("₱20000.00") | **fixed** — through `formatAmountsInText` |
| 43 | Audit log | Prototype: one free-text filter, rows open their case; ours: person, action, dates and case filters, case reference as a link | **kept** (filters); **fixed** — for Compliance, an entry about a visible case opens it from anywhere on its row; entries with no case (sign-ins, simulation changes) and every row for the administrator stay plain rows (new `Table rowClickable`) |
| 44 | Audit log | Monospace on the action code under its label and on the case reference; the time is in the body font (prototype monospace) | **kept** — codes and references are identifiers |

## Automation and documents (lanes C and A)

| # | Screen | Difference | Status |
|---|---|---|---|
| 45 | Automation controls | The product's mode, effect and kill switch were a two-column list with labels on the left, unlike the facts block everywhere else | **fixed** — `KeyValues` (Mode, Kill switch) with the mode's effect as a sentence under it |
| 46 | Automation controls | A blocked action's reason was muted grey; on the case it is the error colour under the button | **fixed** — the same `text-bad-700` reason under the button |
| 47 | Automation controls | Dividers (history list, kill-switch section) used the card border weight | **fixed** — the soft divider (`line-soft`), as inside every card |
| 48 | Decision panel automation banner | An info `Callout` with a bold lead ("Automation shadow: the engine's outcome was …") | matches the shared parts; no change. The prototype has no case-level equivalent (its automation controls live under Configuration › AI models) |
| 49 | Documents card | Prototype `.doc` row: a small file tile ("PDF"), the name, the status pill on the right; ours had no tile and a full-strength divider | **fixed** — the lavender file tile ("PDF" once uploaded, a dash while requested) and the soft divider; the pill stays beside the name so the row's actions keep the right edge |
| 50 | Documents card | Prototype header has an "All versions" ghost button opening the document repository | **later** — no document versions in this release |
| 51 | Request information dialog | The "Documents" group's legend used its own bold style, unlike every form label | **fixed** — the one label style (small, uppercase, tracked), like `Field` |
| 52 | Request information dialog | Prototype offers a free-text list of documents; ours checkboxes of the document types, due in 3 or 5 days | **kept** (typed documents feed the checklist) |

## Operations, reports, providers and decision estimates (lanes B and C)

| # | Screen | Difference | Status |
|---|---|---|---|
| 53 | Booking exceptions | "Last error" and "Retry" showed server sentences with raw amounts | **fixed** — through `formatAmountsInText` |
| 54 | Booking exceptions | Prototype has a "Retry booking" button on each row; ours sends the user to the case | **kept** — a retry runs on the case under the booking rules (maker-checker, the same booking key); the whole row opens the case |
| 55 | Reconciliation panel | Findings: only the case reference opened the case, and "What it means" showed raw amounts | **fixed** — a finding about a case opens it from its row (`rowClickable`; findings with no case stay plain); amounts through `formatAmountsInText`. The prototype's summary facts (bookings sent, confirmed, exceptions, duplicates) match our `KeyValues` |
| 56 | Reports (Decisioning, Origination funnel) | Empty periods showed one muted sentence | **fixed** — the shared `EmptyState`, with a hint to choose a longer period only when a longer one exists (none at 90 days) |
| 57 | Reports | The period filter was component state | **fixed** — kept in the URL (`?days=7\|90`; none means 30), so Back and a shared link keep it |
| 58 | Reports | Prototype funnel adds "Submitted by channel" and "By product"; the decisioning dashboard adds "Automation by product" and a 30+ DPD figure | **later** — one product and one channel in this release; no repayment data for DPD |
| 59 | Provider usage and latency cards | Latency figures were a two-column list with right-aligned values; the empty window was a muted sentence | **fixed** — `KeyValues` and `EmptyState`. The usage table, circuit pills and "Simulated · prices" label already follow the shared parts |
| 60 | Decision panel estimates | Debt-to-income, rate, probability of default, affordable amount and "decided in" were a two-column list; the prototype shows label-over-value facts beside the score (`dl.kv`) | **fixed** — `KeyValues` beside the score; the engine wording ("Affordable amount (engine)", "None" in words, the indicative caption) is unchanged |
| 61 | BarList | Prototype `.hbar` prints the figure in monospace with a 140px label column | **kept** — figures in the body font with tabular numbers (monospace is for identifiers); labels wrap rather than truncate |
| 62 | Reports | Reason codes are shown as "R11 · Sanctions or watchlist match" in the body font | **kept** — the code stays readable as part of the label; a bar label is not an identifier field |

## Routing, SLA, walk-ins and model governance (lanes A, B and C)

| # | Screen | Difference | Status |
|---|---|---|---|
| 63 | Work queue | The prototype's My queue / Team / Unassigned tabs are now the owner filter (counts included); the owner and stage filters were component state | **fixed** — both kept in the URL (`?owner=mine\|unassigned`, `?stage=REVIEW`), so Back from a case restores them; an unknown value falls back to the whole team and all stages |
| 64 | Work queue | Prototype puts Pick in its own column on the Unassigned tab; ours puts it under the owner name on every unassigned referral | **kept** — the owner cell says who acts and offers the action in one place; the button is interactive, so the row click does not fire it |
| 65 | Queue and case SLA | The unavailable line was muted text; the case clock's failure did not say what still works | **fixed** — a neutral `Callout` on the list; on the case "SLA clock unavailable just now; the rest of the case is unaffected." The SLA pill and the "Past SLA" figure match the prototype's SLA column and KPI |
| 66 | Walk-in dialog | The existing applicant's id was in the body font; the "new to the bank cannot be booked" consequence was a small grey note | **fixed** — the id in monospace; the consequence as an info `Callout` ("Not bookable yet.") |
| 67 | Walk-in dialog | Prototype's new-application screen takes the customer inline (a core-customer select); ours opens a dialog with an Existing / New toggle (`SegmentedFilter` used as a mode switch) | **kept** — the toggle is the shared control; the dialog keeps the application form short |
| 68 | Turnaround report | The holiday calendar's limit was gold text | **fixed** — a warning `Callout` |
| 69 | Turnaround report, reconciliation, loan account | A `Table` inside a `Card` draws its own border inside the card's (the prototype's `.bd.np` card has none) | **partly fixed** — `Table framed={false}` drops the table's own frame inside a `Card flush` (the intake drafts card uses it); the cards that keep body padding around a table (turnaround, reconciliation, loan account, governance) keep the inset frame for now — **later**, as one pass |
| 70 | Model governance | Counts printed raw (`1200`) | **fixed** — through `formatNumber` |
| 71 | Model governance | The drift table showed the grade as a plain letter | **fixed** — `GradeTile`, as everywhere else a grade appears |
| 72 | Model governance | Percentages are computed on the page (`toFixed`), not through a shared formatter; PSI below the minimum reads "not computed" with the counts | **later** (percentages: a `formatPercent` in `packages/ui`); the PSI wording already follows the no-figure-below-minimum lesson |

## Email and file intake, extracted data, eligibility pre-check (lanes D and C)

| # | Screen | Difference | Status |
|---|---|---|---|
| 73 | Email and file intake | The drafts table drew its own border inside the `Card flush` | **fixed** — `Table framed={false}`: one border, the card's |
| 74 | Email and file intake | A confirmed draft opened its case only from the reference link | **fixed** — its whole row opens the case (`rowClickable`); drafts still to review keep their Review button and stay plain rows. The To review / All filter already counts from one list and lives in the URL |
| 75 | Review draft dialog | "Create application draft" and "Discard draft" only disabled while working | **fixed** — `busy`, so the button says "Working…" (one request, and the user sees it) |
| 76 | Review draft dialog | A field error with no input in this dialog (e.g. the government ID when OCR read it) is spelled out in the error callout | matches the field-error-needs-its-field lesson; no change |
| 77 | Eligibility pre-check | The rate range and affordable amounts were a two-column list | **fixed** — `KeyValues`; the engine wording ("Affordable amount (engine)", nothing affordable in words) is unchanged |
| 78 | Eligibility pre-check | Before a check the result card showed a muted sentence; check rows used the card-border divider | **fixed** — `EmptyState` ("No check yet"); the soft divider |
| 79 | Eligibility pre-check | The rule-set version in the caveat was in the body font | **fixed** — monospace (an identifier) |
| 80 | Eligibility pre-check | Policy checks show Pass / Review pills, while the decision panel and booking checklist use tinted circle marks | **kept** — a pre-check result is a likelihood, and the pill's word ("Review") carries it; the circle marks stay for decided rule results |
| 81 | Extracted data (OCR) card | Prototype's statement analysis is a `dl.kv`; ours is `KeyValues`, with flags in a warning callout and readings referenced in monospace | matches the shared parts; no change |

## States checked on every screen

Hover (rows, buttons, nav), keyboard focus (rows via their link, buttons, fields, dialogs),
active (nav item, segmented filter, current stage), disabled (one look; blocked actions show
their reason under the button), empty (EmptyState), loading ("Loading…" card) and error
(`Callout` with Try again) all come from the shared parts above.

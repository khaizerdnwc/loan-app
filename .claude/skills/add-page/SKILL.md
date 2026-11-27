---
name: add-page
description: Add a backoffice screen the prototype-faithful way — a Next.js route under apps/backoffice/src/app, data from the API through the same-origin proxy, tokens only, clear outcome and state presentation, a confirmation dialog for every consequential action, loading/empty/error states, and a Playwright step when it is part of a journey. Use for any new or changed staff screen.
argument-hint: "<route — which role uses it — what it shows or does>"
disable-model-invocation: true
---

# Add a page

**STOP.** Name the role(s) who use the screen, what they decide on it, and which actions are
consequential, before writing JSX. The screen follows the prototype's structure and wording;
its look comes only from the tokens in `packages/ui`.

## Rules

1. **Route**: `apps/backoffice/src/app/(staff)/<route>/page.tsx`, inside the shell (sidebar +
   top bar). Navigation entries are per role.
2. **Data**: from the API only, through the same-origin proxy (`/api/...` → the API, the
   session cookie forwarded). The backoffice never imports `@loan/base` or `@loan/contracts`;
   request/response types come from `@loan/core`.
3. **The server decides**: hide or disable what the role cannot do, but every action still
   calls the API, which refuses on its own. Show its RFC 9457 `detail` inline, in words.
4. **Look**: shared components and token classes only (`house/no-raw-colour`); amounts through
   `formatPeso()` (`house/money-through-formatter`), right-aligned, monospaced.
5. **Outcomes and states**: the shared outcome pill (*Auto-approve*, *Refer*, *Auto-decline*)
   and stage pill; reason codes in words; the referral trigger on referred cases; pending
   states name who acts next; *Simulated* on anything from a simulated service.
6. **Consequential actions** (submit, recommend, approve, decline, submit booking, check
   booking, retry, change a failure mode) open a confirmation dialog stating amount, tenor and
   effect; the button shows progress and cannot double-submit.
7. **States**: loading, empty and error for every fetch; accessible labels, focus, Escape.

## Template

```tsx
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await api.getCase(id);            // server-side, through the proxy client
  if (result.kind === "problem") return <ProblemState problem={result.problem} />;
  const c = result.data;
  return (
    <PageHeader title={c.applicant.name} meta={<StagePill stage={c.stage} />}>
      <OutcomeBanner decision={c.decision} />
      <DecisionSummary decision={c.decision} />
      <NextAction caseView={c} />                  {/* client component; confirm dialogs live here */}
      <ActivityTimeline events={c.activity} />
    </PageHeader>
  );
}
```

## Checklist

- [ ] Route in the shell; nav entry only for the roles that use it.
- [ ] Data through the proxy; no domain package imports.
- [ ] Tokens and shared components only; `formatPeso()` for amounts.
- [ ] Outcome, stage, reason codes and *Simulated* labels shown clearly.
- [ ] A confirmation dialog for every consequential action; no double submit.
- [ ] Loading, empty and error states; problems shown readably.
- [ ] Part of F1 or F2? Extend the Playwright journey in `apps/backoffice/e2e/`.
- [ ] `pnpm lint && pnpm typecheck` green, then `/review` — ui-ux owns this.

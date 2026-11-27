---
name: add-endpoint
description: Add an API endpoint the permission-first way — controller handler with @Roles, a whitelisting DTO, the service method with its domain checks, RFC 9457 errors, Swagger, and integration tests for success and every refusal. Use for any new or changed HTTP handler in the API.
argument-hint: "<METHOD /path — who may call it — what it does>"
disable-model-invocation: true
---

# Add an endpoint

**STOP.** Write down who may call it, from which case states, and what each refusal answers,
before writing the handler. The backend is the only place a permission exists; the UI hiding
a button is cosmetic.

## Rules

1. **Roles on the handler**: `@Roles(Role.X, …)` or `@Public()` — the global guard denies
   undeclared routes (`house/require-roles-on-controller-handler`).
2. **Domain checks in the service, inside the transaction**: state legal per the transition
   table; maker ≠ checker by user id for override approval and booking; approver authority by
   amount **and** grade; override needs a reason code and rationale.
3. **DTO**: class-validator, every field decorated; the global pipe whitelists and rejects
   unknown fields. Money is a decimal string validated by pattern; ids are UUIDs.
4. **Errors**: throw the domain errors from `@loan/core`; the filter renders RFC 9457
   (`type`, `title`, `status`, `detail`, `code`). 400 invalid input, 403 role/authority/
   maker-checker, 404 unknown or not visible to this role, 409 illegal state or duplicate.
   No internals in `detail`.
5. **Mutations are throttled**; consequential ones are idempotent where a retry is plausible.
6. **Swagger**: `@ApiTags`, `@ApiOperation`, response types — the reviewers read `/docs`.

## Template

```ts
@ApiTags("approvals")
@Controller("cases/:caseId/approval")
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post()
  @Roles(Role.Approver)
  @ApiOperation({ summary: "Approve, decline or counter-offer a referred case within authority" })
  decide(
    @Param("caseId", new ParseUUIDPipe()) caseId: string,
    @Body() dto: DecideDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.approvals.decide(caseId, actor, dto);
  }
}
```

## Tests (apps/api/test/<feature>.e2e-spec.ts)

- Success: the response body **and** the database (status, amounts, the activity event) —
  never only the status code (`house/no-status-only-assertion`).
- Every other role: 403, and nothing changed.
- Each domain refusal: maker as checker, above authority (amount, and grade), missing override
  reason, illegal state — the 4xx, its `code`, and nothing changed.
- Invalid input: out-of-limit amount/tenor, unknown field, missing field → 400 problem.
- For booking-like actions: replay and two concurrent calls → one effect.

## Checklist

- [ ] `@Roles` matches the permission table in `docs/ARCHITECTURE.md`.
- [ ] Domain checks in the service, inside the transaction.
- [ ] DTO validates everything; money as string.
- [ ] Problems are RFC 9457 with stable codes; nothing internal leaks.
- [ ] Throttled; Swagger annotated.
- [ ] Integration tests for success and every refusal; acceptance criteria name them.
- [ ] `/review` — security and qa own this.

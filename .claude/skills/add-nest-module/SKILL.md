---
name: add-nest-module
description: Scaffold a new feature module in packages/base the boundary-first way — module, entities, repository, service through TransactionRunner, controller with @Roles, DTOs, wiring, and tests. Use when adding a feature folder under packages/base/src/.
argument-hint: "<feature-name>"
disable-model-invocation: true
---

# Add a feature module

**STOP.** Decide what the module owns and what it exports before writing any file. A module
owns its entities and repository; other modules get a service method, never its repository.

## Rules

1. One folder: `packages/base/src/<feature>/`. Entities in `entities/`, DTOs in `dto/`, the
   repository in `<feature>.repository.ts`, the service, the controller, the module.
2. Dependencies point `core ← contracts ← base ← apps`. External services are injected by
   their port token from `@loan/contracts`, never imported from `apps/api/src/adapters`
   (`house/no-provider-import-outside-adapters`).
3. Every state change runs through `TransactionRunner` and goes through the lifecycle
   transition table; its activity event is written in the same transaction.
4. Raw DataSource/EntityManager/`.query()` only in the repository
   (`house/no-datasource-outside-repository`). Money is `Money`, columns `numeric(14,2)`
   (`house/no-float-money`).
5. Every handler declares `@Roles(...)` (`house/require-roles-on-controller-handler`). Domain
   checks (maker-checker, authority, state) live in the service, not the controller.
6. A new table needs a migration (`/add-typeorm-migration`); never `synchronize`.

## Template

```ts
// packages/base/src/<feature>/<feature>.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([<Entity>]), ActivityModule, DatabaseModule],
  controllers: [<Feature>Controller],
  providers: [<Feature>Service, <Feature>Repository],
  exports: [<Feature>Service],
})
export class <Feature>Module {}
```

```ts
// <feature>.service.ts — orchestration only, no SQL
@Injectable()
export class <Feature>Service {
  private readonly logger = new Logger(<Feature>Service.name);
  constructor(
    private readonly tx: TransactionRunner,
    private readonly repo: <Feature>Repository,
    private readonly activity: ActivityService,
  ) {}

  async act(caseId: string, actor: Actor, dto: <Act>Dto) {
    return this.tx.run(async (em) => {
      const c = await this.repo.lockCase(em, caseId);   // FOR UPDATE + state check
      assertTransition(c.status, "<NEXT>", actor);      // the one transition table
      /* domain checks: maker ≠ checker, authority, override reason */
      await this.repo.save(em, /* … */);
      await this.activity.record(em, { caseId, actor, from: c.status, to: "<NEXT>" });
    });
  }
}
```

Register the module in `packages/base/src/index.ts` and import it in
`apps/api/src/app.module.ts`.

## Checklist

- [ ] Module exports only the service other modules need.
- [ ] No adapter import; ports injected by token.
- [ ] Every state change: transaction + transition table + activity event.
- [ ] Every handler has `@Roles(...)`; refusals are RFC 9457 problems with a stable `code`.
- [ ] Migration generated and read (`/add-typeorm-migration`).
- [ ] Unit tests for pure logic in `packages/base/test/`; integration tests in
      `apps/api/test/` for each role boundary and each refusal (`/add-endpoint`).
- [ ] `docs/ACCEPTANCE.md` criteria for the new behaviour name their tests.
- [ ] `pnpm typecheck && pnpm lint && pnpm house:check && pnpm deps:check` green, then `/review`.

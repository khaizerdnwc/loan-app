---
name: add-typeorm-migration
description: Add a TypeORM migration the safe way — change the entity, generate the migration, read and fix it, check constraints for money and idempotency, apply it from empty, and prove there is no drift. Use for any schema change in packages/base.
argument-hint: "<what changes, e.g. add-disbursement-idempotency-key>"
disable-model-invocation: true
---

# Add a migration

**STOP.** The schema changes through migrations only. `synchronize` stays off
(`house/no-typeorm-synchronize`); the PR's `db` job applies every migration to an empty
database and fails on entity/migration drift.

## Rules

1. Change the entity first, then generate; never hand-write what the generator can produce,
   and never commit a generated migration without reading it.
2. Money columns: `numeric(14,2)` with the Money transformer — never float, real, double or
   money (`house/no-float-money`).
3. Duplicate protection lives in the database: a unique constraint or unique index **in the
   migration** for every idempotency key and every one-per-application row (booking, loan
   account, disbursement). An entity decorator alone is not enough.
4. The decision record and activity history are insert-only; a migration never adds a path
   that updates them (no `ON UPDATE CASCADE` into them).
5. Simulator tables live in their own schema (`sim_core`, …), created by their own migration.
6. One migration per change, named after what it does. Never edit a migration that is
   already on `main`; add a new one.

## Steps

```bash
pnpm db:up
pnpm --filter @loan/api run db:migration:generate -- <name>   # writes packages/base/src/database/migrations/<ts>-<name>.ts
# read it: types, nullability, defaults, constraints, indexes, the down() is the exact inverse
pnpm --filter @loan/api run db:migrate
pnpm --filter @loan/api run db:migration:check                # no drift left
pnpm --filter @loan/api run db:seed && pnpm --filter @loan/api run db:seed   # seed stays idempotent
```

A NOT NULL column on a table with rows needs a default or a backfill step in the same
migration.

## Template

```ts
export class AddDisbursementIdempotencyKey1764300000000 implements MigrationInterface {
  name = "AddDisbursementIdempotencyKey1764300000000";

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "disbursement" ADD "idempotency_key" uuid NOT NULL`);
    await q.query(
      `CREATE UNIQUE INDEX "uq_disbursement_idempotency_key" ON "disbursement" ("idempotency_key")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "uq_disbursement_idempotency_key"`);
    await q.query(`ALTER TABLE "disbursement" DROP COLUMN "idempotency_key"`);
  }
}
```

## Checklist

- [ ] Generated, read, and the `down()` reverses `up()` exactly.
- [ ] Money columns `numeric(14,2)`; no float types.
- [ ] Unique constraints for every idempotency key and one-per-application row.
- [ ] Indexes for the columns the work queues filter and sort on.
- [ ] `db:migrate` from empty, `db:migration:check`, seed twice — all green.
- [ ] An integration test exercises the constraint (the duplicate is refused or returns the
      existing row).
- [ ] `/review` — the data reviewer owns this.

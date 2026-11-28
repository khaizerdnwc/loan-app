import "reflect-metadata";
import {
  createDataSource,
  dataSourceOptions,
  MIGRATION_LOCK_KEY,
  MIGRATIONS,
  openDataSource,
  runMigrationsLocked,
} from "@loan/base";
import type { DataSource } from "typeorm";

/**
 * H-4: migrations run under a Postgres advisory lock. Each test uses its own scratch database
 * (next to the test database, dropped afterwards), so it starts from empty; the test role
 * needs the CREATEDB privilege (the local and CI Postgres users have it). The concurrent-boot
 * test is a race detector (four migrators usually collide without the lock, not always); the
 * lock/run/unlock order itself is pinned by packages/base/test/database/migration-lock.test.ts.
 */
const testUrl = new URL(process.env.DATABASE_URL as string);
const scratchName = `${testUrl.pathname.slice(1).replace(/_test$/, "")}_mlock_test`;
const scratchUrl = Object.assign(new URL(testUrl), { pathname: `/${scratchName}` }).toString();

let admin: DataSource;
const opened: DataSource[] = [];

async function track(ds: DataSource | Promise<DataSource>): Promise<DataSource> {
  const d = await ds;
  opened.push(d);
  return d;
}

async function applied(ds: DataSource): Promise<string[]> {
  const rows = (await ds.query("SELECT name FROM migrations ORDER BY id")) as { name: string }[];
  return rows.map((r) => r.name);
}

beforeAll(async () => {
  admin = createDataSource(testUrl.toString());
  await admin.initialize();
});

beforeEach(async () => {
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${scratchName}"`);
});

afterEach(async () => {
  for (const ds of opened.splice(0)) if (ds.isInitialized) await ds.destroy();
});

afterAll(async () => {
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await admin.destroy();
});

describe("migrations under an advisory lock (H-4)", () => {
  it("waits while another process holds the lock, then applies every migration", async () => {
    const holder = await track(createDataSource(scratchUrl).initialize());
    const runner = holder.createQueryRunner();
    await runner.connect();
    await runner.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);

    const replica = await track(createDataSource(scratchUrl).initialize());
    let done = false;
    const run = runMigrationsLocked(replica).finally(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(done).toBe(false);
    const [table] = (await holder.query("SELECT to_regclass('public.migrations') AS t")) as {
      t: string | null;
    }[];
    expect(table?.t).toBeNull(); // nothing touched while the lock is held

    await runner.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
    await runner.release();
    const ran = await run;
    expect(ran).toHaveLength(MIGRATIONS.length);
    expect(await applied(replica)).toHaveLength(MIGRATIONS.length);
  });

  it("gives up with an error after the timeout while the lock stays held, migrating nothing", async () => {
    const holder = await track(createDataSource(scratchUrl).initialize());
    const runner = holder.createQueryRunner();
    await runner.connect();
    await runner.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
    try {
      const replica = await track(createDataSource(scratchUrl).initialize());
      await expect(runMigrationsLocked(replica, { timeoutMs: 300, pollMs: 50 })).rejects.toThrow(
        /Migration lock not free after 300 ms/,
      );
      const [table] = (await holder.query("SELECT to_regclass('public.migrations') AS t")) as {
        t: string | null;
      }[];
      expect(table?.t).toBeNull();
    } finally {
      await runner.release();
    }
  });

  it("four replicas booting at once with MIGRATE_ON_BOOT all start, and each migration runs once", async () => {
    const options = { ...dataSourceOptions(scratchUrl), extra: { max: 3 } };
    const replicas = await Promise.all(
      Array.from({ length: 4 }, () => track(openDataSource(options, true))),
    );
    for (const ds of replicas) expect(ds.isInitialized).toBe(true);
    const names = await applied(replicas[0] as DataSource);
    expect(names).toHaveLength(MIGRATIONS.length);
    expect(new Set(names).size).toBe(MIGRATIONS.length);
    // The lock is free again afterwards.
    const [free] = (await (replicas[1] as DataSource).query(
      "SELECT pg_try_advisory_lock($1::bigint) AS ok",
      [MIGRATION_LOCK_KEY],
    )) as { ok: boolean }[];
    expect(free?.ok).toBe(true);
  });

  it("opens without migrating when MIGRATE_ON_BOOT is off", async () => {
    const ds = await track(openDataSource(dataSourceOptions(scratchUrl), false));
    const [table] = (await ds.query("SELECT to_regclass('public.migrations') AS t")) as {
      t: string | null;
    }[];
    expect(table?.t).toBeNull();
  });
});

import { Logger } from "@nestjs/common";
import { DataSource, type DataSourceOptions, type Migration, type QueryRunner } from "typeorm";

/**
 * The Postgres advisory lock key that serialises migrations (an arbitrary constant, unique to
 * this application). Every process that migrates this database takes it first.
 */
export const MIGRATION_LOCK_KEY = "7643000090";

/** How long a migrator waits for another to finish before giving up (5 minutes). */
export const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 300_000;

export interface MigrationLockOptions {
  /** Give up, with an error, if the lock is not free within this many milliseconds. */
  timeoutMs?: number;
  /** How often to try the lock while another process holds it. */
  pollMs?: number;
  logger?: Pick<Logger, "log" | "warn" | "error">;
}

/**
 * Apply pending migrations while holding a session-level Postgres advisory lock, so several
 * API replicas starting at once with MIGRATE_ON_BOOT (or a replica and `db:migrate`) run them
 * one after another: the first applies them, the rest wait, then find nothing pending.
 * Without it, two processes can both see a migration as pending and the second fails part way.
 *
 * The lock is held on its own connection for the whole run (the migrations use others). It
 * is taken with pg_try_advisory_lock in a poll, so a waiter gives up after `timeoutMs`
 * instead of hanging behind a stuck holder. It is released by unlock or, if the process
 * dies, when that connection closes. Releasing never throws: a failed or refused unlock is
 * logged, so it can never replace the migrations' own result or error.
 */
export async function runMigrationsLocked(
  ds: DataSource,
  options: MigrationLockOptions = {},
): Promise<Migration[]> {
  const {
    timeoutMs = DEFAULT_MIGRATION_LOCK_TIMEOUT_MS,
    pollMs = 500,
    logger = new Logger("migrations"),
  } = options;
  const lock = ds.createQueryRunner();
  await lock.connect();
  try {
    await acquire(lock, timeoutMs, pollMs, logger);
    try {
      return await ds.runMigrations({ transaction: "each" });
    } finally {
      await release(lock, logger);
    }
  } finally {
    await lock.release();
  }
}

async function acquire(
  lock: QueryRunner,
  timeoutMs: number,
  pollMs: number,
  logger: Pick<Logger, "log">,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  for (;;) {
    const [row] = (await lock.query("SELECT pg_try_advisory_lock($1::bigint) AS locked", [
      MIGRATION_LOCK_KEY,
    ])) as { locked: boolean }[];
    if (row?.locked) return;
    if (Date.now() + pollMs > deadline) {
      throw new Error(
        `Migration lock not free after ${timeoutMs} ms: another process is still migrating this database. Nothing was migrated.`,
      );
    }
    if (!waiting) {
      logger.log("Another process holds the migration lock; waiting for it to finish.");
      waiting = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function release(lock: QueryRunner, logger: Pick<Logger, "warn" | "error">): Promise<void> {
  try {
    const [row] = (await lock.query("SELECT pg_advisory_unlock($1::bigint) AS released", [
      MIGRATION_LOCK_KEY,
    ])) as { released: boolean }[];
    if (!row?.released) {
      logger.error(
        "The migration lock was not held when releasing it: another migrator may have run at the same time. Check the migrations table.",
      );
    }
  } catch (err) {
    // The connection is gone, which also frees the session lock.
    logger.warn(
      `Could not release the migration lock (${err instanceof Error ? err.message : String(err)}); it is freed when the connection closes.`,
    );
  }
}

/**
 * Open a DataSource and, when `migrate` is set, apply pending migrations under the lock. The
 * API's TypeOrmModule uses this as its data source factory.
 */
export async function openDataSource(
  options: DataSourceOptions,
  migrate: boolean,
  lockOptions: MigrationLockOptions = {},
): Promise<DataSource> {
  const ds = await new DataSource({ ...options, migrationsRun: false }).initialize();
  if (migrate) {
    try {
      await runMigrationsLocked(ds, lockOptions);
    } catch (err) {
      await ds.destroy();
      throw err;
    }
  }
  return ds;
}

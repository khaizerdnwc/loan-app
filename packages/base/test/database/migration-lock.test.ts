import type { DataSource, Migration } from "typeorm";
import { MIGRATION_LOCK_KEY, runMigrationsLocked } from "../../src/database/migration-lock";

/** A DataSource stub that records the lock calls, the migration run and the release. */
function stub(opts: {
  tryLock?: boolean[];
  run?: () => Promise<Migration[]>;
  unlock?: () => Promise<{ released: boolean }[]>;
}) {
  const calls: string[] = [];
  const tries = [...(opts.tryLock ?? [true])];
  const runner = {
    connect: async () => {
      calls.push("connect");
    },
    query: async (sql: string, params: unknown[]) => {
      expect(params).toEqual([MIGRATION_LOCK_KEY]);
      if (sql.includes("pg_try_advisory_lock")) {
        calls.push("try-lock");
        return [{ locked: tries.length > 1 ? tries.shift() : tries[0] }];
      }
      if (sql.includes("pg_advisory_unlock")) {
        calls.push("unlock");
        return opts.unlock ? opts.unlock() : [{ released: true }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
    release: async () => {
      calls.push("release");
    },
  };
  const ds = {
    createQueryRunner: () => runner,
    runMigrations: async () => {
      calls.push("run");
      return opts.run ? opts.run() : [];
    },
  } as unknown as DataSource;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { ds, calls, logger };
}

const done = [{ name: "M1" }] as Migration[];

describe("runMigrationsLocked (H-4)", () => {
  it("takes the lock, runs the migrations, unlocks, then releases the connection", async () => {
    const { ds, calls, logger } = stub({ run: async () => done });
    await expect(runMigrationsLocked(ds, { logger })).resolves.toBe(done);
    expect(calls).toEqual(["connect", "try-lock", "run", "unlock", "release"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("waits while another process holds the lock, then runs", async () => {
    const { ds, calls, logger } = stub({ tryLock: [false, false, true] });
    await runMigrationsLocked(ds, { pollMs: 1, logger });
    expect(calls).toEqual([
      "connect",
      "try-lock",
      "try-lock",
      "try-lock",
      "run",
      "unlock",
      "release",
    ]);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout without migrating, and still releases the connection", async () => {
    const { ds, calls, logger } = stub({ tryLock: [false] });
    await expect(runMigrationsLocked(ds, { timeoutMs: 20, pollMs: 5, logger })).rejects.toThrow(
      /Migration lock not free after 20 ms/,
    );
    expect(calls).not.toContain("run");
    expect(calls).not.toContain("unlock");
    expect(calls.at(-1)).toBe("release");
  });

  it("unlocks and rethrows the migration's own error", async () => {
    const { ds, calls, logger } = stub({
      run: async () => {
        throw new Error("migration 7 failed");
      },
    });
    await expect(runMigrationsLocked(ds, { logger })).rejects.toThrow("migration 7 failed");
    expect(calls).toEqual(["connect", "try-lock", "run", "unlock", "release"]);
  });

  it("an unlock error never replaces the migration's error", async () => {
    const { ds, logger } = stub({
      run: async () => {
        throw new Error("migration 7 failed");
      },
      unlock: async () => {
        throw new Error("connection lost");
      },
    });
    await expect(runMigrationsLocked(ds, { logger })).rejects.toThrow("migration 7 failed");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("connection lost"));
  });

  it("an unlock error after a successful run is logged, and the result kept", async () => {
    const { ds, logger } = stub({
      run: async () => done,
      unlock: async () => {
        throw new Error("connection lost");
      },
    });
    await expect(runMigrationsLocked(ds, { logger })).resolves.toBe(done);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("reports an unlock that finds the lock not held (another migrator may have run)", async () => {
    const { ds, logger } = stub({ unlock: async () => [{ released: false }] });
    await runMigrationsLocked(ds, { logger });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("not held"));
  });
});

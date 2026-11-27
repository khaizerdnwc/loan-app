import "reflect-metadata";
import { createDataSource, dropEverything, seed } from "@loan/base";
import { Logger } from "@nestjs/common";
import { env } from "../config/env";

/**
 * Database commands: `node dist/cli/db.js migrate | seed | reset`.
 *  - migrate: apply every pending migration (each in its own transaction).
 *  - seed: upsert the synthetic demo data (safe to run twice).
 *  - reset: drop everything, migrate and seed — development and demo resets only; refused
 *    when NODE_ENV is production.
 */
const logger = new Logger("db");

async function main(command: string | undefined): Promise<void> {
  const ds = createDataSource(env().DATABASE_URL);
  await ds.initialize();
  try {
    if (command === "reset") {
      if (env().NODE_ENV === "production") throw new Error("reset is refused in production");
      await dropEverything(ds);
    }
    if (command === "migrate" || command === "reset") {
      const ran = await ds.runMigrations({ transaction: "each" });
      logger.log(`migrations applied: ${ran.length}`);
    }
    if (command === "seed" || command === "reset") {
      const counts = await seed(ds);
      logger.log(`seeded ${counts.staff} staff and ${counts.applicants} applicants`);
    }
    if (!["migrate", "seed", "reset"].includes(command ?? "")) {
      throw new Error("usage: db.js migrate | seed | reset");
    }
  } finally {
    await ds.destroy();
  }
}

main(process.argv[2]).catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

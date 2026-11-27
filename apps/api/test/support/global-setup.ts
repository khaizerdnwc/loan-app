import "reflect-metadata";
import "./env";
import { createDataSource, dropEverything, seed } from "@loan/base";

/** Once per run: an empty test database, every migration, the synthetic seed. */
export default async function globalSetup(): Promise<void> {
  const ds = createDataSource(process.env.DATABASE_URL as string);
  await ds.initialize();
  try {
    await dropEverything(ds);
    await ds.runMigrations({ transaction: "each" });
    await seed(ds);
  } finally {
    await ds.destroy();
  }
}

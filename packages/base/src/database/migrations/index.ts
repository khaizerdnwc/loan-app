import { LendingSchema1764300000000 } from "./1764300000000-LendingSchema";
import { SimulatorsSchema1764300000001 } from "./1764300000001-SimulatorsSchema";
import { InsertOnlyRecords1764300000002 } from "./1764300000002-InsertOnlyRecords";

/**
 * Every migration, in order. Listed explicitly so the same list runs from src (tests) and
 * dist (deployments). A new migration is generated (`pnpm --filter @loan/api
 * db:migration:generate ../../packages/base/src/database/migrations/<Name>`), renamed to
 * the next timestamp in this list, and added here.
 */
export const MIGRATIONS = [
  LendingSchema1764300000000,
  SimulatorsSchema1764300000001,
  InsertOnlyRecords1764300000002,
];

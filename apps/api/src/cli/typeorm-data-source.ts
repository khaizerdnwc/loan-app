import "reflect-metadata";
import { createDataSource } from "@loan/base";
import { env } from "../config/env";

/**
 * The data source the TypeORM CLI loads (from dist) for `migration:generate` and the
 * entity/migration drift check in the gate (`db:migration:check`).
 */
export default createDataSource(env().DATABASE_URL);

/**
 * @fileoverview The schema changes through migrations only.
 *
 * `synchronize: true` lets TypeORM alter tables to match the entities at boot. It can
 * drop a column holding data, it never runs in a reviewed order, and the migrations stop
 * describing the real schema — so the integration job's "migrations from empty" proves
 * nothing. Schema changes are generated migrations, reviewed by the data role.
 *
 * Scope: every file outside tests.
 */
import { filenameOf, isTestFile, repoRelative } from "../_app-path.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow TypeORM synchronize: true; use migrations.",
      owner: "data",
    },
    schema: [],
    messages: {
      synchronize:
        "`synchronize: true` alters the schema at boot, outside any migration. Set it to false " +
        "and add a migration (`pnpm --filter @loan/api db:migration:generate`).",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (isTestFile(rel)) return {};
    return {
      Property(node) {
        if (
          node.key.type === "Identifier" &&
          node.key.name === "synchronize" &&
          node.value.type === "Literal" &&
          node.value.value === true
        ) {
          context.report({ node, messageId: "synchronize" });
        }
      },
    };
  },
};

/**
 * @fileoverview Raw database access lives in repositories and the database module only.
 *
 * Services orchestrate; they do not write SQL. A service that injects the DataSource or
 * calls `.query()` bypasses the repository that knows the row lock, the unique constraint
 * and the transaction the booking depends on — and spreads SQL where the data reviewer
 * will not look for it.
 *
 * Flags, in server code outside `*.repository.ts`, `packages/base/src/database/**`,
 * migrations and seeds:
 *  - `@InjectDataSource()` / `@InjectEntityManager()`,
 *  - `new DataSource(...)`,
 *  - a raw `.query(...)` call.
 * A service runs a unit of work through `TransactionRunner` from the database module.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

function allowed(rel) {
  return (
    rel.endsWith(".repository.ts") ||
    rel.startsWith("packages/base/src/database/") ||
    /\/migrations\//.test(rel) ||
    /\/seed\//.test(rel) ||
    // A simulated provider keeps its own state; it is not lending code.
    rel.startsWith("apps/api/src/adapters/")
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "DataSource, EntityManager injection and raw queries only in repositories and the database module.",
      owner: "data",
    },
    schema: [],
    messages: {
      inject:
        "`@{{name}}()` outside a repository. Put the query in a `*.repository.ts`, and run units " +
        "of work through `TransactionRunner` (packages/base/src/database).",
      newDataSource: "Create the DataSource only in packages/base/src/database.",
      rawQuery:
        "Raw `.query()` outside a repository or migration. Move it into the repository that owns " +
        "the table, where the data reviewer looks for SQL.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel) || allowed(rel)) return {};
    return {
      Decorator(node) {
        const expr = node.expression;
        const name =
          expr.type === "CallExpression" && expr.callee.type === "Identifier"
            ? expr.callee.name
            : null;
        if (name === "InjectDataSource" || name === "InjectEntityManager") {
          context.report({ node, messageId: "inject", data: { name } });
        }
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "DataSource") {
          context.report({ node, messageId: "newDataSource" });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "query" &&
          node.arguments[0] &&
          (node.arguments[0].type === "Literal" || node.arguments[0].type === "TemplateLiteral")
        ) {
          context.report({ node, messageId: "rawQuery" });
        }
      },
    };
  },
};

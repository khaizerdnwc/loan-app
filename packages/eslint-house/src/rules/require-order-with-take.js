/**
 * @fileoverview A limited query needs an order, or the rows it returns are arbitrary.
 *
 * Postgres returns rows in no particular order without ORDER BY. `take: 20` then picks a
 * different 20 between calls, so a work queue reshuffles on refresh and "the latest
 * decision" may not be the latest. Ported in spirit from nxlvl's require-orderby-with-limit
 * (Drizzle), rewritten for TypeORM.
 *
 * Flags, in server code:
 *  - an options object with `take` or `skip` but no `order`,
 *  - a query-builder chain calling `.take()`/`.limit()` with no `.orderBy()` in the chain.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

function keyName(prop) {
  if (prop.type !== "Property") return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return null;
}

/** Every member-call name in a chain like a.b().c().d(). */
function chainNames(node) {
  const out = [];
  let cur = node;
  while (cur) {
    if (cur.type === "CallExpression") cur = cur.callee;
    else if (cur.type === "MemberExpression") {
      if (cur.property.type === "Identifier") out.push(cur.property.name);
      cur = cur.object;
    } else if (cur.type === "AwaitExpression") cur = cur.argument;
    else break;
  }
  return out;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "TypeORM take/skip/limit must come with an explicit order.",
      owner: "data",
    },
    schema: [],
    messages: {
      options: "`{{key}}` without `order`: the rows returned are arbitrary. Add `order: { … }`.",
      chain: "`.{{key}}()` without `.orderBy()` in the chain: the rows returned are arbitrary.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel)) return {};
    return {
      ObjectExpression(node) {
        const keys = new Set(node.properties.map(keyName).filter(Boolean));
        const limited = ["take", "skip"].find((k) => keys.has(k));
        if (limited && !keys.has("order")) {
          context.report({ node, messageId: "options", data: { key: limited } });
        }
      },
      CallExpression(node) {
        // Only the outermost call of a chain, so each chain is reported once.
        if (node.parent?.type === "MemberExpression" && node.parent.object === node) return;
        const names = chainNames(node);
        const limited = names.find((n) => n === "take" || n === "limit");
        if (
          limited &&
          names.includes("createQueryBuilder") &&
          !names.includes("orderBy") &&
          !names.includes("addOrderBy")
        ) {
          context.report({ node, messageId: "chain", data: { key: limited } });
        }
      },
    };
  },
};

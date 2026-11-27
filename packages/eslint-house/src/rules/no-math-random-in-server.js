/**
 * @fileoverview Server-side values an outsider could guess must come from a CSPRNG.
 *
 * `Math.random()` is predictable given samples and seeded per process. An idempotency key,
 * a loan account number or a session id minted from it can be guessed or collide — and an
 * idempotency-key collision is exactly a duplicate booking. Use `crypto.randomUUID()` or
 * `randomBytes`. Ported from nxlvl (where it guarded public object keys).
 *
 * Scope: server code (apps/api/src, packages/{base,core,contracts}/src). Tests and seeds
 * are exempt: seeds invent demo data and guard nothing.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Server-side code must not mint values with Math.random(); use crypto.randomUUID()/randomBytes.",
      owner: "security",
    },
    schema: [],
    messages: {
      mathRandom:
        "`Math.random()` is not cryptographically random. Keys, ids, account numbers and tokens " +
        "must use `crypto.randomUUID()` (or `randomBytes` for a specific length). For a value that " +
        "is purely cosmetic: `// eslint-disable-next-line house/no-math-random-in-server -- <why>`.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel) || /\/seed\//.test(rel)) return {};
    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "Math" &&
          node.property.type === "Identifier" &&
          node.property.name === "random"
        ) {
          context.report({ node, messageId: "mathRandom" });
        }
      },
    };
  },
};

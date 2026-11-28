/**
 * @fileoverview The provider gateway is never called inside a transaction callback.
 *
 * No row lock is held while a provider answers (ADR 0020; "Providers are called before the
 * transaction" in cases.service.ts). A provider can take seconds, retry with backoff, or time
 * out; inside `tx.run(...)` the case row stays locked for all of it, so every other request on
 * that case queues behind a call to a simulated bureau, and the transaction holds a pooled
 * connection while it waits. The inputs are gathered first, then the transaction locks, re-checks
 * and writes.
 *
 * (Before H7 the case lock was FOR UPDATE, and the gateway's own `provider_call` insert, made on
 * a second connection with a foreign key to loan_case, would also have waited on that lock. The
 * case lock is FOR NO KEY UPDATE now, which a foreign-key check does not wait on, so that is no
 * longer the reason; the lock-duration reason above still is.)
 *
 * Flags, in packages/base/src outside tests, inside a function passed to `<x>.tx.run(…)`,
 * `tx.run(…)` or `<x>.transaction(…)`: any call on a `this.<field>` whose constructor
 * parameter is typed ProviderGateway, and any `.gatherInputs(…)` call (DecisionService's
 * provider fan-out).
 *
 * Limits — not caught: the gateway reached through an alias (`const g = this.gateway`), passed
 * into the callback as an argument or a closure variable, or called from a helper method that
 * the callback invokes (only the callback's own body, and functions nested in it, are read);
 * a port called directly rather than through the gateway; a transaction started some other way
 * (a raw QueryRunner). Review covers those.
 *
 * Opt out where the rule genuinely does not apply:
 *   // eslint-disable-next-line house/no-provider-call-in-transaction -- <why>
 */
import { filenameOf, isTestFile, repoRelative } from "../_app-path.js";

const GATEWAY_TYPES = new Set(["ProviderGateway"]);
const FANOUT_METHODS = new Set(["gatherInputs"]);

function propName(member) {
  if (member.type !== "MemberExpression" || member.computed) return null;
  return member.property.type === "Identifier" ? member.property.name : null;
}

/** `a.tx.run(fn)`, `tx.run(fn)`, `this.tx.run(fn)`, `ds.transaction(fn)`, `m.transaction(fn)`. */
function isTransactionCall(call) {
  const callee = call.callee;
  const name = propName(callee);
  if (name === "transaction") return true;
  if (name !== "run") return false;
  const obj = callee.object;
  if (obj.type === "Identifier") return obj.name === "tx";
  return propName(obj) === "tx";
}

const isFunction = (n) => n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Call the provider gateway before the transaction, never inside tx.run().",
      owner: "data",
      lesson: "data-20261128-provider-call-outside-lock",
    },
    schema: [],
    messages: {
      inTransaction:
        "Provider calls run before the transaction (gather the inputs first, then tx.run): no " +
        "row lock is held while a provider answers (ADR 0020), or every request on the case " +
        "waits behind a slow, retrying or timing-out provider. If this transaction holds no " +
        "row lock, opt out with a reason: " +
        "// eslint-disable-next-line house/no-provider-call-in-transaction -- <why>",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!rel.startsWith("packages/base/src/") || isTestFile(rel)) return {};

    const gatewayFields = new Set();
    const candidates = [];

    return {
      TSParameterProperty(node) {
        const p = node.parameter;
        const ann = p.typeAnnotation?.typeAnnotation;
        if (
          p.type === "Identifier" &&
          ann?.type === "TSTypeReference" &&
          ann.typeName.type === "Identifier" &&
          GATEWAY_TYPES.has(ann.typeName.name)
        ) {
          gatewayFields.add(p.name);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (FANOUT_METHODS.has(propName(callee))) {
          candidates.push({ node, field: null });
          return;
        }
        const obj = callee.object;
        if (obj.type === "MemberExpression" && obj.object.type === "ThisExpression") {
          const field = propName(obj);
          if (field) candidates.push({ node, field });
        }
      },
      "Program:exit"() {
        for (const { node, field } of candidates) {
          if (field !== null && !gatewayFields.has(field)) continue;
          const ancestors = context.sourceCode.getAncestors(node);
          const inside = ancestors.some(
            (a, i) =>
              isFunction(a) &&
              ancestors[i - 1]?.type === "CallExpression" &&
              ancestors[i - 1].arguments.includes(a) &&
              isTransactionCall(ancestors[i - 1]),
          );
          if (inside) context.report({ node, messageId: "inTransaction" });
        }
      },
    };
  },
};

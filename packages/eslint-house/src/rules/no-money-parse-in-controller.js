/**
 * @fileoverview A controller must not parse request input with `Money.of(...)`.
 *
 * The DTOs validate amounts with class-validator's `@IsDecimal`, which accepts strings that
 * `Money.of` rejects (".", "+5", "-.", a 30-digit whole part). `Money.of` then throws
 * `MoneyError`, which the problem filter does not map, so a malformed query string answers a
 * generic 500 and logs a stack instead of a 400 VALIDATION_FAILED with a field error (RFC 9457,
 * AGENTS.md Non-negotiable 2: decimal strings on the API, validated). It bit
 * `GET /products/PL/quote` (2026-11-28). Parse in the service through a guarded helper
 * (cases.service.ts `parseAmount`: Money or null, then `termErrors` reports the field), or
 * catch `MoneyError` and throw `validation(...)`.
 *
 * Scope: `*.controller.ts` in server code. Constant literals are exempt (`Money.of("0.00")`).
 *
 * Opt out where the value is already proven to be a Money string:
 *   // eslint-disable-next-line house/no-money-parse-in-controller -- <why>
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

function isMoneyOf(callee) {
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Money") return false;
  const p = callee.property;
  if (!callee.computed) return p.type === "Identifier" && p.name === "of";
  return p.type === "Literal" && p.value === "of";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Controllers must not call Money.of on request input; parse through a guarded helper that answers 400.",
      owner: "security",
    },
    schema: [],
    messages: {
      moneyOfInController:
        '`Money.of` throws `MoneyError` on strings `@IsDecimal` lets through (".", "+5"), which ' +
        "answers a 500. Parse in the service with a guarded helper (cases.service.ts `parseAmount` " +
        "returns Money | null; `termErrors` turns null into a field error), or catch `MoneyError` " +
        "and throw `validation(...)` from ./domain-error. If the value is already proven a Money " +
        "string: `// eslint-disable-next-line house/no-money-parse-in-controller -- <why>`.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel) || !/\.controller\.ts$/.test(rel)) return {};
    return {
      CallExpression(node) {
        if (!isMoneyOf(node.callee)) return;
        const [arg] = node.arguments;
        // A constant literal cannot be attacker-shaped.
        if (arg && arg.type === "Literal" && typeof arg.value === "string") return;
        context.report({ node, messageId: "moneyOfInController" });
      },
    };
  },
};

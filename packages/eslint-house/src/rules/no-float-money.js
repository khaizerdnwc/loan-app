/**
 * @fileoverview Money is never a JavaScript number.
 *
 * Loan Operations and Finance "won't accept a centavo out of place". IEEE-754 doubles
 * cannot represent most centavo amounts (0.1 + 0.2 !== 0.3), so a schedule built from
 * numbers drifts by centavos and stops reconciling to principal + interest. Every amount
 * is a `Money` (packages/core, decimal.js underneath); the database column is
 * NUMERIC(14,2); the API carries strings.
 *
 * Flags, in server code:
 *  - arithmetic (+ - * / %) where an operand is named like money (amount, principal,
 *    interest, balance, instalment, fee, payment, total, disbursement…),
 *  - `parseFloat`/`Number`/unary `+` applied to a money-named value, and `.toFixed()` on one,
 *  - a TypeORM column typed float, double precision, real or money.
 *
 * Exempt: the Money implementation itself (packages/core/src/money/), and tests.
 * Counts (tenor in months, number of instalments) are integers, not money: name them so.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

const MONEY_NAME =
  /(amount|principal|interest|balance|instal+ment|fee|payment|total|disburs|price|peso|centavo|income|obligation)/i;
const NOT_MONEY =
  /(count|months|tenor|number|index|rate|percent|bps|id|days|score|version|attempts)$/i;
const FLOAT_COLUMN = new Set([
  "float",
  "double",
  "double precision",
  "real",
  "money",
  "float4",
  "float8",
]);

function nameOf(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }
  if (node.type === "TSNonNullExpression") return nameOf(node.expression);
  return null;
}

function isMoneyNamed(node) {
  const name = nameOf(node);
  return Boolean(name && MONEY_NAME.test(name) && !NOT_MONEY.test(name));
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Money values must use Money (decimal), never number arithmetic or float columns.",
      owner: "data",
    },
    schema: [],
    messages: {
      arithmetic:
        "`{{name}}` looks like money, and this is number arithmetic. Use `Money` from @loan/core " +
        "(`a.plus(b)`, `a.times(rate)`, `.roundCentavo()`) so centavos stay exact.",
      conversion:
        "Converting `{{name}}` to a number loses centavos. Keep it a `Money` (`Money.of(string)`) " +
        "and format it with `formatPeso()` for display.",
      floatColumn:
        "A `{{type}}` column cannot hold centavos exactly. Money columns are " +
        "`numeric` with precision 14, scale 2 and the MoneyTransformer.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel) || rel.startsWith("packages/core/src/money/")) return {};
    return {
      BinaryExpression(node) {
        if (!["+", "-", "*", "/", "%"].includes(node.operator)) return;
        for (const side of [node.left, node.right]) {
          if (isMoneyNamed(side)) {
            context.report({ node, messageId: "arithmetic", data: { name: nameOf(side) } });
            return;
          }
        }
      },
      CallExpression(node) {
        const arg = node.arguments[0];
        const callee = node.callee;
        if (
          callee.type === "Identifier" &&
          (callee.name === "parseFloat" || callee.name === "Number") &&
          isMoneyNamed(arg)
        ) {
          context.report({ node, messageId: "conversion", data: { name: nameOf(arg) } });
        }
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "toFixed" &&
          isMoneyNamed(callee.object)
        ) {
          context.report({ node, messageId: "conversion", data: { name: nameOf(callee.object) } });
        }
      },
      UnaryExpression(node) {
        if (node.operator === "+" && isMoneyNamed(node.argument)) {
          context.report({ node, messageId: "conversion", data: { name: nameOf(node.argument) } });
        }
      },
      Property(node) {
        if (
          node.key.type === "Identifier" &&
          node.key.name === "type" &&
          node.value.type === "Literal" &&
          typeof node.value.value === "string" &&
          FLOAT_COLUMN.has(node.value.value.toLowerCase())
        ) {
          context.report({
            node: node.value,
            messageId: "floatColumn",
            data: { type: node.value.value },
          });
        }
      },
    };
  },
};

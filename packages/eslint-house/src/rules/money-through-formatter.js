/**
 * @fileoverview Peso amounts are displayed through one formatter.
 *
 * The API sends money as decimal strings ("150000.00"). Formatting them ad hoc —
 * `Number(x).toLocaleString()`, a hand-typed "₱" — converts to a float on the way and
 * gives each screen its own rounding and its own spacing. One `formatPeso()` keeps every
 * amount on every screen identical to what the schedule stores.
 *
 * Flags in web code: a "₱" in a string literal, and `toLocaleString(` or
 * `new Intl.NumberFormat(` — everywhere except the formatter module itself
 * (`src/lib/format.ts` in a web package).
 */
import { filenameOf, isWebCode, repoRelative } from "../_app-path.js";

const FORMAT_MODULE = /^(apps\/backoffice|packages\/ui)\/src\/lib\/format\.ts$/;

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Display peso amounts only through formatPeso().",
      owner: "ui-ux",
    },
    schema: [],
    messages: {
      peso: 'Format amounts with `formatPeso(value)` instead of writing "₱" by hand.',
      localeFormat:
        "Use `formatPeso()` / `formatNumber()` from lib/format instead of formatting here: one " +
        "formatter keeps every screen's rounding identical to the stored amounts.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || FORMAT_MODULE.test(rel)) return {};
    return {
      Literal(node) {
        if (typeof node.value === "string" && node.value.includes("₱")) {
          context.report({ node, messageId: "peso" });
        }
      },
      TemplateElement(node) {
        if ((node.value.cooked ?? "").includes("₱")) context.report({ node, messageId: "peso" });
      },
      JSXText(node) {
        if (node.value.includes("₱")) context.report({ node, messageId: "peso" });
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "toLocaleString"
        ) {
          context.report({ node, messageId: "localeFormat" });
        }
      },
      NewExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Intl" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "NumberFormat"
        ) {
          context.report({ node, messageId: "localeFormat" });
        }
      },
    };
  },
};

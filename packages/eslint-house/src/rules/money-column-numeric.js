/**
 * @fileoverview A table column that shows peso amounts is declared `numeric: true`.
 *
 * Amounts stacked in a column are right-aligned with tabular figures so the pesos and
 * centavos line up and an officer can compare rows at a glance (ui-ux conventions, Money and
 * accessibility). `Table` from `@loan/ui` does that for a column marked `numeric: true`; a
 * column that forgets it renders amounts ragged-left. Found on the reconciliation findings
 * table (reconciliation-panel.tsx, Amounts column) on 2026-11-28, where the amounts went
 * through a local helper.
 *
 * Flags, in web code, an object literal with `header` and `render` whose render calls
 * `formatPeso(…)` — directly or through a function declared in the same file that does —
 * and has no `numeric: true`.
 *
 * Opt out where the cell genuinely is prose that merely mentions an amount:
 *   // eslint-disable-next-line house/money-column-numeric -- <why>
 */
import { filenameOf, isWebCode, repoRelative } from "../_app-path.js";

const SKIP_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"]);

/** Names of the functions `node`'s subtree calls (callee identifiers only). */
function calledNames(node, out = new Set()) {
  if (!node || typeof node.type !== "string") return out;
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    out.add(node.callee.name);
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) calledNames(c, out);
    else if (child && typeof child.type === "string") calledNames(child, out);
  }
  return out;
}

function prop(obj, name) {
  return obj.properties.find(
    (p) =>
      p.type === "Property" &&
      !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === name) ||
        (p.key.type === "Literal" && p.key.value === name)),
  );
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Declare `numeric: true` on a table column that renders formatPeso() amounts.",
      owner: "ui-ux",
    },
    schema: [],
    messages: {
      notNumeric:
        "This column shows peso amounts but is not `numeric: true`, so its amounts are not " +
        "right-aligned with tabular figures. Add `numeric: true` to the column (Table in " +
        "@loan/ui aligns it). If the cell is prose that only mentions an amount, opt out with " +
        "`// eslint-disable-next-line house/money-column-numeric -- <why>`.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel)) return {};

    /** name → names it calls, for function declarations and `const f = () => …`. */
    const functions = new Map();
    const columns = [];

    const remember = (name, fn) => functions.set(name, calledNames(fn.body));

    return {
      FunctionDeclaration(node) {
        if (node.id) remember(node.id.name, node);
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (
          node.id.type === "Identifier" &&
          (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression")
        ) {
          remember(node.id.name, init);
        }
      },
      ObjectExpression(node) {
        if (prop(node, "header") && prop(node, "render")) columns.push(node);
      },
      "Program:exit"() {
        /** Does calling `names` reach formatPeso, through same-file functions? */
        const reachesPeso = (names, seen = new Set()) => {
          for (const n of names) {
            if (n === "formatPeso") return true;
            if (seen.has(n) || !functions.has(n)) continue;
            seen.add(n);
            if (reachesPeso(functions.get(n), seen)) return true;
          }
          return false;
        };
        for (const col of columns) {
          const numeric = prop(col, "numeric");
          if (numeric?.value.type === "Literal" && numeric.value.value === true) continue;
          const render = prop(col, "render");
          if (reachesPeso(calledNames(render.value))) {
            context.report({ node: render, messageId: "notNumeric" });
          }
        }
      },
    };
  },
};

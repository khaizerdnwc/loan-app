/**
 * @fileoverview An `aria-label` that does not contain the control's visible
 * text replaces that text as its accessible name — flag it (WCAG 2.5.3,
 * Label in Name).
 *
 * `aria-label` wins over content: a button that SHOWS "What's going on?" but
 * carries `aria-label="Write a post"` is announced as "Write a post", and a
 * voice-control user who says "click What's going on" hits nothing. Home's
 * composer prompt shipped exactly that (2026-10-05). The fix is to drop the
 * aria-label (the visible text already names it), or to make the label START
 * with / contain the visible words ("What's going on? Write a post").
 *
 * Scope: intrinsic elements whose `aria-label` is a static string and whose
 * children are static text — JSXText, string literals, or an identifier bound
 * to a module-level `const X = "…"` in the same file. Anything dynamic is
 * skipped rather than guessed. Comparison ignores case, punctuation and runs
 * of whitespace.
 *
 * Opt out where the visible text is genuinely not a name (a count, a glyph):
 *   // eslint-disable-next-line house/require-label-in-name -- <why>
 */
import { sep } from "node:path";
import { appRelative } from "../_app-path.js";

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "An aria-label must contain the element's visible text (WCAG 2.5.3).",
      owner: "ui-ux",
      lesson: "ui-ux-20261005-aria-label-hides-visible-text",
    },
    schema: [],
    messages: {
      labelNotInName:
        'aria-label "{{label}}" does not contain the visible text "{{text}}", so it replaces it as ' +
        "the accessible name and voice control can't target what the user sees (WCAG 2.5.3). " +
        "Drop the aria-label (the text already names the control) or make it contain the visible " +
        "words. Opt out only when the text is not a name: " +
        "// eslint-disable-next-line house/require-label-in-name -- <why>",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const rel = appRelative(filename);
    if (!rel.startsWith(`src${sep}`)) return {};
    if (!rel.endsWith(".tsx")) return {};
    if (TEST_SUFFIXES.some((s) => rel.endsWith(s))) return {};

    /** Module-level `const X = "literal"`. */
    const consts = new Map();
    /** Decided at Program:exit, so a const declared below its use still resolves. */
    const elements = [];

    function visibleText(element) {
      let text = "";
      for (const child of element.children) {
        if (child.type === "JSXText") {
          text += child.value;
          continue;
        }
        if (child.type === "JSXExpressionContainer") {
          const e = child.expression;
          if (e.type === "JSXEmptyExpression") continue;
          const lit = staticString(e);
          if (lit !== null) {
            text += lit;
            continue;
          }
          if (e.type === "Identifier" && consts.has(e.name)) {
            text += consts.get(e.name);
            continue;
          }
          return null; // dynamic: do not guess
        }
        return null; // a nested element (an icon, a span): out of scope
      }
      return text;
    }

    return {
      "Program > VariableDeclaration[kind='const'] > VariableDeclarator, Program > ExportNamedDeclaration > VariableDeclaration[kind='const'] > VariableDeclarator"(
        node,
      ) {
        if (node.id.type !== "Identifier") return;
        const s = staticString(node.init);
        if (s !== null) consts.set(node.id.name, s);
      },
      JSXElement(node) {
        elements.push(node);
      },
      "Program:exit"() {
        for (const node of elements) check(node);
      },
    };

    function check(node) {
      const opening = node.openingElement;
      if (opening.name.type !== "JSXIdentifier") return;
      if (!/^[a-z]/.test(opening.name.name)) return; // intrinsic only
      const attr = opening.attributes.find(
        (a) => a.type === "JSXAttribute" && a.name?.name === "aria-label",
      );
      if (!attr?.value) return;
      let label = null;
      if (attr.value.type === "Literal") label = staticString(attr.value);
      else if (attr.value.type === "JSXExpressionContainer") {
        label = staticString(attr.value.expression);
      }
      if (label === null) return;
      const text = visibleText(node);
      if (text === null) return;
      const visible = normalize(text);
      if (!visible) return;
      if (normalize(label).includes(visible)) return;
      context.report({
        node: attr,
        messageId: "labelNotInName",
        data: { label, text: text.trim() },
      });
    }
  },
};

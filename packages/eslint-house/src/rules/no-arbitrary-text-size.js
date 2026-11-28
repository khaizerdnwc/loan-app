/**
 * @fileoverview Text sizes come from the type scale, never `text-[…px]`.
 *
 * The backoffice had fourteen one-off sizes (10.5, 11, 11.5, 12.5, 13, 13.5, 14.5, 15, 28 and
 * 32px) beside Tailwind's rem sizes, which render at 0.875× because the root font is 14px.
 * Labels, card titles and figures drifted from screen to screen. The scale lives in
 * apps/backoffice/src/app/globals.css `@theme`: text-2xs, xs, sm, base, title, lg, stat,
 * display. A new size is a new token there, not an arbitrary value in a component.
 *
 * Checks className strings (attribute values, template literals and expressions inside
 * them) and `cn(…)` arguments under apps/backoffice/src and packages/ui/src.
 *
 * Opt out where a one-off size is genuinely right (an SVG label, a third-party embed):
 *   // eslint-disable-next-line house/no-arbitrary-text-size -- <why>
 */
import { filenameOf, isTestFile, isWebCode, repoRelative } from "../_app-path.js";

/** `md:hover:text-[13px]` → `text-[13px]`, ignoring variants inside brackets. */
function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "");
}

/** An arbitrary font size: `text-[15px]`, `text-[1.1rem]`, `text-[0.9em]`, `text-[length:…]`. */
const ARBITRARY_SIZE = /^text-\[(?:length:[^\]]+|\d*\.?\d+(?:px|rem|em))\](?:\/.+)?$/;

function arbitrarySizes(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => ARBITRARY_SIZE.test(utilityOf(token)));
}

/** Whether a string node sits in a className attribute or a cn(…) call. */
function inClassContext(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === "JSXAttribute") {
      return (
        a.name?.type === "JSXIdentifier" && (a.name.name === "className" || a.name.name === "class")
      );
    }
    if (a.type === "CallExpression") {
      if (a.callee.type === "Identifier" && a.callee.name === "cn") return true;
    }
    if (a.type === "JSXElement" || a.type === "Program" || a.type === "FunctionDeclaration") {
      return false;
    }
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Use the type-scale tokens (text-2xs … text-display), not text-[…px].",
      owner: "ui-ux",
    },
    schema: [],
    messages: {
      arbitrary:
        "`{{token}}` is an arbitrary text size. Use the type scale from globals.css @theme — " +
        "text-2xs (11px), text-xs (12), text-sm (13), text-base (14), text-title (15), text-lg " +
        "(18), text-stat (28), text-display (32) — or add a token there if none fits.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || isTestFile(rel)) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function check(node, text) {
      const found = arbitrarySizes(text);
      if (found.length === 0) return;
      if (!inClassContext(sourceCode.getAncestors(node))) return;
      for (const token of found) {
        context.report({ node, messageId: "arbitrary", data: { token } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw ?? "");
      },
    };
  },
};

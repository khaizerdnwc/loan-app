/**
 * @fileoverview Colours come from the design tokens, never literals in components.
 *
 * The backoffice copies the prototype's look now and will be restyled later. That is a
 * one-file change (the @theme tokens in globals.css) only if no component hard-codes a
 * colour. A hex, rgb() or hsl() literal — or a Tailwind arbitrary colour like
 * `bg-[#D88728]` — in a .tsx is a colour the restyle will miss.
 *
 * Scope: .tsx under apps/backoffice/src and packages/ui/src. CSS files hold the tokens and
 * are not linted by ESLint.
 */
import { filenameOf, isWebCode, repoRelative } from "../_app-path.js";

const RAW = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\()/;

function textOf(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateElement") return node.value.cooked ?? node.value.raw;
  if (node.type === "JSXText") return null;
  return null;
}

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow raw colour literals in components; use theme tokens.",
      owner: "ui-ux",
    },
    schema: [],
    messages: {
      raw:
        "Raw colour `{{value}}`. Use a theme token class (bg-gold-500, text-ink-900, …) or " +
        "`var(--color-…)`; add a token to globals.css if none fits.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || !rel.endsWith(".tsx")) return {};
    const check = (node) => {
      const text = textOf(node);
      if (!text) return;
      const m = RAW.exec(text);
      if (!m) return;
      // An in-page anchor like href="#main-content" is not a colour.
      if (/^#[A-Za-z][\w-]*$/.test(text.trim()) && /[g-zG-Z_-]/.test(text)) return;
      context.report({ node, messageId: "raw", data: { value: m[1] } });
    };
    return { Literal: check, TemplateElement: check };
  },
};

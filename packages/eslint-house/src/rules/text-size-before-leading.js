/**
 * @fileoverview In `cn()`, a `leading-*` that comes BEFORE a font-size `text-*`
 * (same variant) is silently dropped — flag it.
 *
 * Tailwind's font-size utilities (`text-sm`, `text-[15px]`) set a line-height
 * too, so tailwind-merge treats a later `text-<size>` as overriding an earlier
 * `leading-*` and removes the leading class from the output. The class is in
 * the source, reviewers see it, and it does nothing: the line-height falls back
 * to the size's default. Written the other way round (`text-sm leading-tight`)
 * both survive, because a `leading-*` after a size wins.
 *
 * Only `cn(...)` calls (our tailwind-merge wrapper, `@/lib/utils`): a plain
 * `className="…"` string is not merged, so its order does not matter.
 *
 * Opt out where the drop is intended:
 *   // eslint-disable-next-line house/text-size-before-leading -- <why>
 */
import { sep } from "node:path";
import { appRelative } from "../_app-path.js";

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/** `md:hover:leading-6` → { variant: "md:hover:", utility: "leading-6" }. */
function split(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) start = i + 1;
  }
  return {
    variant: token.slice(0, start),
    utility: token.slice(start).replace(/^!/, "").replace(/!$/, ""),
  };
}

/** Tailwind's named sizes plus this repo's type-scale tokens (globals.css @theme). */
const NAMED_SIZE = /^text-(?:2xs|xs|sm|base|title|lg|stat|display|[2-9]?xl)(?:\/.+)?$/;
/** An arbitrary font size: `text-[15px]`, `text-[1.1rem]`, `text-[length:…]`. */
const ARBITRARY_SIZE = /^text-\[(?:length:[^\]]+|\d*\.?\d+(?:px|rem|em))\](?:\/.+)?$/;

const isSize = (utility) => NAMED_SIZE.test(utility) || ARBITRARY_SIZE.test(utility);
const isLeading = (utility) => utility.startsWith("leading-");

const MAX_PATHS = 64;

/** Concatenate every path of `a` with every path of `b` (capped). */
function product(a, b) {
  const out = [];
  for (const x of a) for (const y of b) if (out.length < MAX_PATHS) out.push([...x, ...y]);
  return out;
}

/**
 * The class lists an expression can produce, one per path through it: a
 * ternary's two branches are alternatives, never both, so each is its own
 * path; `cond && "x"` is "x" or nothing. Static strings only.
 */
function paths(node) {
  if (!node || typeof node !== "object") return [[]];
  if (node.type === "Literal") return [typeof node.value === "string" ? [node.value] : []];
  if (node.type === "TemplateLiteral") {
    let out = [node.quasis.map((q) => q.value.cooked ?? "")];
    for (const e of node.expressions) out = product(out, paths(e));
    return out;
  }
  if (node.type === "ConditionalExpression") {
    return [...paths(node.consequent), ...paths(node.alternate)].slice(0, MAX_PATHS);
  }
  if (node.type === "LogicalExpression") {
    return node.operator === "&&"
      ? [[], ...paths(node.right)]
      : [...paths(node.left), ...paths(node.right)].slice(0, MAX_PATHS);
  }
  if (node.type === "ArrayExpression") {
    let out = [[]];
    for (const el of node.elements) out = product(out, paths(el));
    return out;
  }
  if (node.type === "ObjectExpression") {
    // { "class": cond } — each key may or may not apply.
    let out = [[]];
    for (const prop of node.properties) {
      if (prop.type === "Property" && prop.key?.type === "Literal") {
        out = product(out, [[], [String(prop.key.value)]]);
      }
    }
    return out;
  }
  return [[]];
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "In cn(), put a font-size text-* before any leading-* of the same variant.",
      owner: "ui-ux",
      lesson: "ui-ux-20260918-cn-drops-leading-class-when",
    },
    schema: [],
    messages: {
      leadingDropped:
        "`{{leading}}` comes before `{{size}}` in this cn() call, so tailwind-merge drops it " +
        "(a font-size utility sets a line-height too, and the later one wins) — the class does " +
        "nothing. Put the size first: `{{size}} {{leading}}`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const rel = appRelative(filename);
    if (!rel.startsWith(`src${sep}`)) return {};
    if (!rel.endsWith(".tsx") && !rel.endsWith(".ts")) return {};
    if (TEST_SUFFIXES.some((s) => rel.endsWith(s))) return {};

    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "cn") return;
        let all = [[]];
        for (const arg of node.arguments) all = product(all, paths(arg));
        for (const strings of all) {
          // The first leading-* seen per variant, until a size of that variant follows it.
          const pending = new Map();
          for (const str of strings) {
            for (const token of str.split(/\s+/)) {
              if (!token) continue;
              const { variant, utility } = split(token);
              if (isLeading(utility)) {
                if (!pending.has(variant)) pending.set(variant, token);
              } else if (isSize(utility) && pending.has(variant)) {
                context.report({
                  node,
                  messageId: "leadingDropped",
                  data: { leading: pending.get(variant), size: token },
                });
                return;
              }
            }
          }
        }
      },
    };
  },
};

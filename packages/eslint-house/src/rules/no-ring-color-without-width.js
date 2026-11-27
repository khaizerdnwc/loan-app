/**
 * @fileoverview A ring COLOUR on an element whose class list carries no ring
 * WIDTH paints nothing — flag it.
 *
 * Tailwind's `ring-<colour>` only sets `--tw-ring-color`; the ring itself is
 * drawn by a width utility (`ring`, `ring-2`, `ring-[3px]`). The fields in
 * `src/components/ui/` kept their invalid state as `aria-invalid:ring-destructive/20`
 * and borrowed the width from `focus-visible:ring-[3px]`. When that focus ring
 * was swapped for the `field-glow` utility (a box-shadow that deliberately
 * skips `[aria-invalid="true"]`), the width went with it: an invalid field then
 * had no error ring AND, being `outline-none`, no focus indicator at all — a
 * WCAG 2.4.7 failure that looks like nothing in the diff. The OTP boxes hit the
 * same trap earlier (see the comment in `otp-input.tsx`).
 *
 * Scope: `className` on INTRINSIC elements (`<input>`, `<div>`) only. A colour
 * passed to a component (`<Textarea className="focus-visible:ring-sky-400/60">`)
 * may legitimately lean on the width that component ships, which this rule
 * cannot see from here.
 *
 * Opt out where the width genuinely comes from elsewhere on the same element:
 *   // eslint-disable-next-line house/no-ring-color-without-width -- <where the width is>
 */
import { sep } from "node:path";
import { appRelative } from "../_app-path.js";

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

/** The utility after its variants: `dark:aria-invalid:ring-x/40` → `ring-x/40`. */
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

const WIDTH =
  /^ring(?:-\d+(?:\.\d+)?|-\[\d*\.?\d+(?:px|rem|em)\]|-\[length:[^\]]+\]|-\(length:[^)]+\))?$/;

function classify(utility) {
  if (WIDTH.test(utility)) return "width";
  if (!utility.startsWith("ring-")) return null;
  if (utility.startsWith("ring-offset-") || utility === "ring-inset") return null;
  // An arbitrary value that is not a length could be either; do not guess.
  if (utility.startsWith("ring-[") || utility.startsWith("ring-(")) {
    return /^ring-[[(](?:color:|#|rgb|hsl|oklch|oklab)/.test(utility) ? "color" : null;
  }
  return "color";
}

/** Every static class string reachable inside an expression (cn args, ternaries, &&). */
function collectStrings(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.type === "Literal") {
    if (typeof node.value === "string") out.push(node.value);
    return;
  }
  if (node.type === "TemplateLiteral") {
    for (const q of node.quasis) out.push(q.value.cooked ?? "");
    for (const e of node.expressions) collectStrings(e, out);
    return;
  }
  // Keys of an object literal passed to cn/clsx are class strings too.
  if (node.type === "Property") {
    if (node.key?.type === "Literal") collectStrings(node.key, out);
    collectStrings(node.value, out);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) collectStrings(c, out);
    else if (child && typeof child.type === "string") collectStrings(child, out);
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "A ring colour utility needs a ring width utility on the same element.",
      owner: "ui-ux",
      lesson: "ui-ux-20260919-aria-invalid-ring-destructive-20",
    },
    schema: [],
    messages: {
      colorWithoutWidth:
        "`{{token}}` sets only the ring's colour, and nothing in this className sets a ring " +
        "WIDTH (`ring`, `ring-2`, `ring-[3px]`), so it paints nothing. On a field that is " +
        "`outline-none` that can leave an invalid, focused control with no focus indicator " +
        "at all (WCAG 2.4.7). Add the width under the same variant — e.g. " +
        "`aria-invalid:ring-[3px] aria-invalid:ring-destructive/40` — or drop the dead colour. " +
        "If the width really is set elsewhere on this element: " +
        "// eslint-disable-next-line house/no-ring-color-without-width -- <where>",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const rel = appRelative(filename);
    if (!rel.startsWith(`src${sep}`)) return {};
    if (!rel.endsWith(".tsx")) return {};
    if (TEST_SUFFIXES.some((s) => rel.endsWith(s))) return {};

    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "className") return;
        const opening = node.parent;
        const tag = opening?.name;
        // Intrinsic elements only: `input`, `div` — not `Textarea`, not `motion.div`.
        if (!tag || tag.type !== "JSXIdentifier" || !/^[a-z]/.test(tag.name)) return;

        const strings = [];
        collectStrings(node.value, strings);
        let firstColor = null;
        let hasWidth = false;
        for (const s of strings) {
          for (const token of s.split(/\s+/)) {
            if (!token) continue;
            const kind = classify(utilityOf(token));
            if (kind === "width") hasWidth = true;
            else if (kind === "color" && !firstColor) firstColor = token;
          }
        }
        if (firstColor && !hasWidth) {
          context.report({ node, messageId: "colorWithoutWidth", data: { token: firstColor } });
        }
      },
    };
  },
};

/**
 * @fileoverview A `title` on an always-disabled control is an explanation nobody
 * can read — flag it.
 *
 * The house Button carries `disabled:pointer-events-none`, so a disabled Button
 * never receives the hover that shows a `title` tooltip; a disabled native
 * control is also out of the tab order, so keyboard and screen-reader users never
 * reach it either, and touch has no hover at all. The Riot "Link" button in
 * Settings → Profile → Game Accounts (riot-link-section.tsx, 2026-11-18) said why
 * linking was unavailable only in `title` (and an aria-label on the same
 * unreachable button): the reason reached no one.
 *
 * Scope: JSX in `src/` whose `disabled` is bare or `{true}` — always disabled —
 * and which also sets `title`. A conditional `disabled={x}` is left alone (the
 * title is readable whenever the control is enabled).
 *
 * Fix: say it in visible text next to the control (a muted line or the field's
 * own placeholder), or wrap the control in a focusable element that carries the
 * tooltip. Opt out only where the title is decorative:
 *   // eslint-disable-next-line house/no-title-on-disabled-control -- <why>
 */
import { sep } from "node:path";
import { appRelative } from "../_app-path.js";

const TEST_SUFFIXES = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

function attr(node, name) {
  return node.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name.type === "JSXIdentifier" && a.name.name === name,
  );
}

/** `disabled`, `disabled={true}`, `disabled="disabled"` — always disabled. */
function alwaysDisabled(a) {
  if (!a) return false;
  if (a.value === null) return true;
  if (a.value.type === "Literal") return a.value.value !== false && a.value.value !== "false";
  if (a.value.type === "JSXExpressionContainer") {
    const e = a.value.expression;
    return e.type === "Literal" && e.value === true;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Do not explain an always-disabled control only through its title tooltip.",
      owner: "ui-ux",
      lesson: "ui-ux-20261118-title-on-disabled-control",
    },
    schema: [],
    messages: {
      titleOnDisabled:
        "This control is always disabled, so its `title` never shows: the house Button has " +
        "disabled:pointer-events-none (no hover), a disabled control is out of the tab order " +
        "(no keyboard or screen reader), and touch has no hover. Put the reason in visible text " +
        "beside the control, or wrap it in a focusable element that carries the tooltip.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    const rel = appRelative(filename);
    if (!rel.startsWith(`src${sep}`)) return {};
    if (!rel.endsWith(".tsx")) return {};
    if (TEST_SUFFIXES.some((s) => rel.endsWith(s))) return {};

    return {
      JSXOpeningElement(node) {
        const title = attr(node, "title");
        if (!title) return;
        if (!alwaysDisabled(attr(node, "disabled"))) return;
        context.report({ node: title, messageId: "titleOnDisabled" });
      },
    };
  },
};

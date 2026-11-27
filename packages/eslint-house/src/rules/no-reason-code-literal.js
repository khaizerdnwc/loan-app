/**
 * @fileoverview The backoffice never branches on a reason-code literal ("R10", "R13", …).
 *
 * The case screen decided "referred because a provider could not answer" by looking for R10
 * or R13 in the decision's reason codes. When the engine added the fraud check (R17, fraud
 * check unavailable), the API's own predicate learned it and the screen did not: the API
 * offered "Decide again" while the next-action text told the officer to review and
 * recommend. Reason codes are the engine's vocabulary and grow with every rule set; what a
 * case is waiting for, and what may be done to it, is the API's to say (AGENTS.md §2.1: the
 * UI only mirrors). Display codes from the API's data; never test for one by literal.
 *
 * Flags a string literal or a plain template literal that is exactly a reason code (R + two
 * or three digits) anywhere in apps/backoffice/src or packages/ui/src, except as an object
 * key. Tests are exempt.
 *
 * Opt out where a literal code is genuinely display-only (a legend, an example):
 *   // eslint-disable-next-line house/no-reason-code-literal -- <why>
 */
import { filenameOf, isTestFile, isWebCode, repoRelative } from "../_app-path.js";

const REASON_CODE = /^R\d{2,3}$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not branch on reason-code literals in the backoffice; use what the API says about the case.",
      owner: "ui-ux",
      lesson: "ui-ux-20261128-no-reason-code-mirror",
    },
    schema: [],
    messages: {
      literal:
        "`{{code}}` is a reason-code literal. A screen that tests for reason codes goes stale " +
        "when the engine adds one (R17 was missed this way). Use the API's view instead: " +
        "`allowedActions` (e.g. whether REDECIDE is offered) or a field on CaseDetail / " +
        "DecisionRecordView; add the field in packages/base/src/cases/case-views.ts if none fits. " +
        "Display-only use: // eslint-disable-next-line house/no-reason-code-literal -- <why>",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || isTestFile(rel)) return {};

    function isObjectKey(node) {
      const p = node.parent;
      return (
        p &&
        (p.type === "Property" || p.type === "MethodDefinition") &&
        p.key === node &&
        !p.computed
      );
    }

    function report(node, code) {
      context.report({ node, messageId: "literal", data: { code } });
    }

    return {
      Literal(node) {
        if (typeof node.value !== "string" || !REASON_CODE.test(node.value)) return;
        if (isObjectKey(node)) return;
        if (
          node.parent?.type === "ImportDeclaration" ||
          node.parent?.type === "ExportNamedDeclaration"
        )
          return;
        report(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length !== 0) return;
        const text = node.quasis[0]?.value.cooked ?? "";
        if (REASON_CODE.test(text)) report(node, text);
      },
    };
  },
};

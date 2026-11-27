/**
 * @fileoverview The backoffice never keys behaviour on a rule-set or scorecard version literal
 * ("RS-PL-2", "SC-PL-1").
 *
 * The decision panel kept its own table of score-band edges keyed by rule-set version. It
 * stopped at RS-PL-2, so when RS-PL-3 went live every new decision lost its score band, and
 * only the F1/F2 browser journeys noticed at merge. Versions are the engine's and grow with
 * every release (ADR 0022); anything a screen needs about a version comes on the decision view
 * from the API, read from the record's own rule set.
 *
 * Flags a string literal, a plain template literal or an object key that is exactly an engine
 * version (RS-… or SC-… ending in a number) in apps/backoffice/src and packages/ui/src. Tests
 * are exempt.
 *
 * Opt out where a version is genuinely display-only copy:
 *   // eslint-disable-next-line house/no-engine-version-literal -- <why>
 */
import { filenameOf, isTestFile, isWebCode, repoRelative } from "../_app-path.js";

const VERSION = /^(?:RS|SC)-[A-Z]+-\d+$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Do not key screens on rule-set or scorecard versions; use what the decision view carries.",
      owner: "ui-ux",
      lesson: "ui-ux-20261128-no-engine-version-table",
    },
    schema: [],
    messages: {
      literal:
        "`{{version}}` is an engine version literal. A table or branch keyed by version goes " +
        "stale when the engine adds one (RS-PL-3 lost its score band this way). Read what you " +
        "need from DecisionRecordView (e.g. `scoreBand`); add the field in " +
        "packages/base/src/cases/case-views.ts `decisionView` if none fits.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || isTestFile(rel)) return {};

    function report(node, version) {
      context.report({ node, messageId: "literal", data: { version } });
    }

    return {
      // Quoted object keys are Literals too (an unquoted key cannot hold a hyphen).
      Literal(node) {
        if (typeof node.value === "string" && VERSION.test(node.value)) report(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length !== 0) return;
        const text = node.quasis[0]?.value.cooked ?? "";
        if (VERSION.test(text)) report(node, text);
      },
    };
  },
};

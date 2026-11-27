/**
 * @fileoverview The backoffice branches on a refusal's problem code through `ProblemCode`, never a string literal.
 *
 * Which dialog closes, which message shows and which action stays offered after a refusal all
 * hang on `err.code` / `a.blockedBy` (Engineering Standard 6: understandable states, useful
 * errors). A hand-typed `"INVALID_STATE_TRANSITION"` compiles against `string`, so a typo or a
 * renamed code silently skips the branch and the screen goes back to the stale dialog the
 * branch existed to prevent. `ProblemCode` in `@loan/core` is the one list the API emits.
 * Found reviewing the AML escalation dialog (escalation-actions.tsx) on 2026-11-28.
 *
 * Opt out where the code genuinely is not a problem code:
 *   // eslint-disable-next-line house/problem-code-through-constant -- <why>
 */
import { filenameOf, isTestFile, isWebCode, repoRelative } from "../_app-path.js";

const EQUALITY = new Set(["===", "!==", "==", "!="]);
const CODE_PROPERTIES = new Set(["code", "blockedBy"]);
/** Problem codes are SCREAMING_SNAKE with at least one underscore; reason codes (R10) are not. */
const PROBLEM_CODE_SHAPE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "ChainExpression")
  ) {
    n = n.expression;
  }
  return n;
}

function readsCode(node) {
  const n = unwrap(node);
  if (n?.type !== "MemberExpression") return false;
  if (n.computed) return n.property.type === "Literal" && CODE_PROPERTIES.has(n.property.value);
  return n.property.type === "Identifier" && CODE_PROPERTIES.has(n.property.name);
}

function codeLiteral(node) {
  const n = unwrap(node);
  if (n?.type === "Literal" && typeof n.value === "string" && PROBLEM_CODE_SHAPE.test(n.value))
    return n;
  if (
    n?.type === "TemplateLiteral" &&
    n.expressions.length === 0 &&
    PROBLEM_CODE_SHAPE.test(n.quasis[0]?.value.cooked ?? "")
  )
    return n;
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Compare a problem code against ProblemCode from @loan/core, never a string literal.",
      owner: "ui-ux",
      lesson: "ui-ux-20261127-dialog-follows-refreshed-case",
    },
    schema: [],
    messages: {
      literal:
        "Problem code compared as the literal {{code}}. A typo or a renamed code skips this branch " +
        "silently. Use the constant: `ProblemCode.<Name>` from `@loan/core`. If this is not a " +
        "problem code, opt out with `// eslint-disable-next-line house/problem-code-through-constant -- <why>`.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isWebCode(rel) || isTestFile(rel)) return {};

    const report = (lit) =>
      context.report({
        node: lit,
        messageId: "literal",
        data: { code: lit.type === "Literal" ? JSON.stringify(lit.value) : "template" },
      });

    return {
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;
        const lit =
          (readsCode(node.left) && codeLiteral(node.right)) ||
          (readsCode(node.right) && codeLiteral(node.left));
        if (lit) report(lit);
      },
      SwitchStatement(node) {
        if (!readsCode(node.discriminant)) return;
        for (const c of node.cases) {
          const lit = c.test && codeLiteral(c.test);
          if (lit) report(lit);
        }
      },
    };
  },
};

/**
 * @fileoverview A success test must check what succeeded, not only the status code.
 *
 * `.expect(201)` passes for a booking endpoint that returns 201 and books nothing, or
 * books twice. The requirement is that "the case status, decision record, loan account,
 * schedule and disbursement record agree" — a test that never looks at the body or the
 * database cannot fail when they don't.
 *
 * Flags a test (`it`/`test`) whose only assertions are 2xx status checks
 * (`.expect(200)`, `.expect(201)`…). A 4xx-only test is allowed: "an approver cannot
 * book → 403" is the assertion. Scope: API test files.
 */
import { filenameOf, repoRelative } from "../_app-path.js";

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, visit);
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "A test whose only assertions are 2xx status codes asserts nothing about the outcome.",
      owner: "qa",
    },
    schema: [],
    messages: {
      statusOnly:
        "This test only checks a success status. Assert the outcome too: the response body " +
        "(status, amounts, ids) and, for a state change, what the database now holds.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!/^apps\/api\/test\/.+\.(e2e-spec|spec|test)\.ts$/.test(rel)) return {};
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "Identifier" || !["it", "test"].includes(callee.name)) return;
        const fn = node.arguments[1];
        if (!fn || !["ArrowFunctionExpression", "FunctionExpression"].includes(fn.type)) return;
        let success = 0;
        let other = 0;
        walk(fn.body, (n) => {
          if (n.type !== "CallExpression") return;
          if (n.callee.type === "Identifier" && n.callee.name === "expect") other++;
          if (
            n.callee.type === "MemberExpression" &&
            n.callee.property.type === "Identifier" &&
            n.callee.property.name === "expect"
          ) {
            const arg = n.arguments[0];
            if (arg?.type === "Literal" && typeof arg.value === "number") {
              if (arg.value >= 200 && arg.value < 300) success++;
            } else {
              other++;
            }
          }
          // Helpers named assert*/expect* count as assertions.
          if (n.callee.type === "Identifier" && /^(assert|expect)[A-Z]/.test(n.callee.name))
            other++;
        });
        if (success > 0 && other === 0) context.report({ node, messageId: "statusOnly" });
      },
    };
  },
};

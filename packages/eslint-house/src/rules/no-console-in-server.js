/**
 * @fileoverview Server code logs through Nest's Logger, never console.
 *
 * console.* has no level, no context and no way to turn it down, and on the API it can
 * print a request body — applicant data — straight into the host's log. Nest's `Logger`
 * carries the class name and goes through one configured sink.
 *
 * Scope: apps/api/src and packages/{base,core,contracts}/src, outside tests.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Server code must log through Nest's Logger, not console.",
      owner: "security",
    },
    schema: [],
    messages: {
      console:
        "Use Nest's `Logger` (`private readonly logger = new Logger(MyService.name)`) instead of " +
        "`console.{{method}}` — and never log applicant data or request bodies.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel)) return {};
    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "console" &&
          node.property.type === "Identifier"
        ) {
          context.report({ node, messageId: "console", data: { method: node.property.name } });
        }
      },
    };
  },
};

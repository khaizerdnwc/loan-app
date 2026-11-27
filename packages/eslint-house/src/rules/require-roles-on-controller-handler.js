/**
 * @fileoverview Every HTTP handler states who may call it.
 *
 * The roles guard is global and denies a route that declares nothing (fail closed), but a
 * handler with no `@Roles(...)` and no `@Public()` is still a decision nobody wrote down:
 * the reviewer cannot see from the code which role it is for. Compliance asks exactly that
 * ("a loan officer cannot approve, an approver cannot book"), so the answer is on the
 * handler, or on its controller class.
 *
 * Scope: classes decorated with `@Controller(...)` in server code.
 */
import { filenameOf, isServerCode, repoRelative } from "../_app-path.js";

const HTTP_METHODS = new Set(["Get", "Post", "Put", "Patch", "Delete", "All", "Head", "Options"]);
const DECLARES_ACCESS = new Set(["Roles", "Public"]);

function decoratorName(decorator) {
  const expr = decorator.expression;
  if (expr.type === "CallExpression" && expr.callee.type === "Identifier") return expr.callee.name;
  if (expr.type === "Identifier") return expr.name;
  return null;
}

function names(decorators) {
  return new Set((decorators ?? []).map(decoratorName).filter(Boolean));
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every controller handler declares @Roles(...) or @Public(), on itself or its class.",
      owner: "security",
    },
    schema: [],
    messages: {
      missing:
        "Handler `{{name}}` does not say who may call it. Add `@Roles(Role.X, ...)` (or `@Public()` " +
        "for an endpoint that needs no sign-in, such as health) to the handler or its controller. " +
        "The global guard denies undeclared routes, so without this the endpoint answers 403.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isServerCode(rel)) return {};
    return {
      ClassDeclaration(cls) {
        const classDecorators = names(cls.decorators);
        if (!classDecorators.has("Controller")) return;
        const classDeclares = [...DECLARES_ACCESS].some((d) => classDecorators.has(d));
        for (const member of cls.body.body) {
          if (member.type !== "MethodDefinition") continue;
          const own = names(member.decorators);
          if (![...HTTP_METHODS].some((m) => own.has(m))) continue;
          if (classDeclares || [...DECLARES_ACCESS].some((d) => own.has(d))) continue;
          const name = member.key.type === "Identifier" ? member.key.name : "handler";
          context.report({ node: member.key, messageId: "missing", data: { name } });
        }
      },
    };
  },
};

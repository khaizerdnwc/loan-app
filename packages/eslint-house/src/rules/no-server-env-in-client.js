/**
 * @fileoverview The backoffice's server environment module is imported only by server code.
 *
 * `apps/backoffice/src/config/env.ts` reads process.env (the API's internal URL today, more
 * later). Imported from a page, a component or a client helper, Next.js bundles it for the
 * browser. This rule stands in for the `server-only` package (not installed): only route
 * handlers (`app/**\/route.ts`), `middleware.ts` and `src/config/` may import it. The module
 * also throws when it is evaluated in a browser, which catches transitive imports at runtime.
 *
 * Opt out for a module that is genuinely server-only (a server component with no client
 * importer):
 *   // eslint-disable-next-line house/no-server-env-in-client -- <why it never reaches the browser>
 */
import { posix } from "node:path";
import { filenameOf, isTestFile, repoRelative } from "../_app-path.js";

const SRC = "apps/backoffice/src/";
const ENV_MODULE = `${SRC}config/env`;

function allowedImporter(rel) {
  const inside = rel.slice(SRC.length);
  return (
    /^app\/(.+\/)?route\.tsx?$/.test(inside) ||
    /^middleware\.tsx?$/.test(inside) ||
    inside.startsWith("config/")
  );
}

/** The repo-relative module a specifier names, without extension, or null if not local. */
function resolveSpecifier(rel, specifier) {
  let target;
  if (specifier.startsWith("@/")) target = SRC + specifier.slice(2);
  else if (specifier.startsWith(".")) target = posix.join(posix.dirname(rel), specifier);
  else return null;
  return posix
    .normalize(target)
    .replace(/\.(tsx?|jsx?|mjs|cjs)$/, "")
    .replace(/\/index$/, "");
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Import the backoffice's config/env only from route handlers and middleware.",
      owner: "security",
    },
    schema: [],
    messages: {
      clientImport:
        "`config/env` is server-only and would be bundled for the browser from here. Read it in " +
        "a route handler (`app/**/route.ts`) or `middleware.ts` and pass the value on, or call " +
        "the API through the `/api` proxy instead.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!rel.startsWith(SRC) || isTestFile(rel) || allowedImporter(rel)) return {};

    /** Report `source` (a module specifier node) if it names config/env. */
    function check(source) {
      let specifier = null;
      if (source?.type === "Literal" && typeof source.value === "string") specifier = source.value;
      if (source?.type === "TemplateLiteral" && source.expressions.length === 0) {
        specifier = source.quasis[0]?.value.cooked ?? null;
      }
      if (specifier !== null && resolveSpecifier(rel, specifier) === ENV_MODULE) {
        context.report({ node: source, messageId: "clientImport" });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") {
          check(node.arguments[0]);
        }
      },
    };
  },
};

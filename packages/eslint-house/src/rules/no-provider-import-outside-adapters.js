/**
 * @fileoverview Workflow and decision code talk to external services only through ports.
 *
 * Engineering Standard 9: each simulated external service sits behind its own interface
 * (packages/contracts) "so a real provider could replace it later without changes to
 * your workflow or decision logic". That holds only if nothing outside the adapter layer
 * imports a concrete provider. The API's composition root (app.module.ts and the
 * adapters folder) is the one place that picks the implementation.
 *
 * Flags any import of an adapter module (a path containing `/adapters/`, or `simulated`)
 * from outside apps/api/src/adapters/**, apps/api/src/app.module.ts and tests.
 */
import { filenameOf, isTestFile, repoRelative } from "../_app-path.js";

function isAdapterSpecifier(source) {
  return /(^|\/)adapters(\/|$)/.test(source) || /(^|[/-])simulated([/-]|$)/.test(source);
}

function allowed(rel) {
  return (
    rel.startsWith("apps/api/src/adapters/") ||
    rel === "apps/api/src/app.module.ts" ||
    isTestFile(rel) ||
    !/^(apps|packages)\/[^/]+\/src\//.test(rel)
  );
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Only the adapter layer and the composition root import concrete providers.",
      owner: "architecture",
    },
    schema: [],
    messages: {
      adapterImport:
        "`{{source}}` is a concrete provider. Depend on the port from @loan/contracts and inject " +
        "it by its token; only apps/api/src/app.module.ts and the adapters folder choose the " +
        "implementation (Engineering Standard 9).",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (allowed(rel)) return {};
    const check = (node) => {
      const source = node.source?.value;
      if (typeof source === "string" && isAdapterSpecifier(source)) {
        context.report({ node, messageId: "adapterImport", data: { source } });
      }
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
  },
};

/**
 * @fileoverview Environment variables are read in exactly one validated place per app.
 *
 * Each app has `src/config/env.ts`, a Zod schema that validates the environment at boot
 * and fails fast with a readable message. A `process.env.X` anywhere else skips that
 * validation: a missing JWT_SECRET becomes `undefined` at the first request instead of a
 * boot error, and env-example-parity can no longer see the variable.
 *
 * Scope: product source under apps/* and packages/* (tests and config files at a
 * package root, like next.config.ts, are outside src/ and not checked).
 */
import { filenameOf, isProductCode, repoRelative } from "../_app-path.js";

const CONFIG_FILE = /^apps\/[^/]+\/src\/config\/env\.ts$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Read process.env only in apps/<app>/src/config/env.ts.",
      owner: "security",
    },
    schema: [],
    messages: {
      processEnv:
        "Read environment variables only in `src/config/env.ts` (validated at boot), and import " +
        "the typed value from there. Add the key to the schema and to the app's .env.example.",
    },
  },
  create(context) {
    const rel = repoRelative(filenameOf(context));
    if (!isProductCode(rel) || CONFIG_FILE.test(rel)) return {};
    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          node.object.name === "process" &&
          node.property.type === "Identifier" &&
          node.property.name === "env"
        ) {
          context.report({ node, messageId: "processEnv" });
        }
      },
    };
  },
};

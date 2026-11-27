/**
 * @fileoverview A caught error's `.name` is a minified class name in production — never branch on it.
 *
 * Error subclasses set `this.name = this.constructor.name`. That is a *derived*
 * string: the production minifier renames the class, so `err.name` is `"l"` in a
 * built bundle and the full class name only in dev. Any `===` against it passes
 * every local test and silently falls through in production.
 *
 * This is not hypothetical. `signInAction` matched
 * `name === "CredentialsSignin"` to turn a wrong password into "Invalid username
 * or password." In production that branch never matched, the error rethrew, and
 * every failed sign-in on a real account rendered "Internal server error" —
 * visible only as `[safe-action] unexpected error l: ...#credentialssignin` in
 * the Railway logs.
 *
 * Branch on something declared as a literal instead, which minification cannot
 * touch:
 *   - Auth.js  → `err.type` (`CredentialsSignin.type = "CredentialsSignin"`)
 *   - AppError → `err.code` (@/lib/errors)
 *   - Postgres → `err.code` (SQLSTATE)
 *   - otherwise → `err instanceof SomeError` (class identity survives renaming)
 *
 * Reading `.name` is fine — logging it, reporting it to Sentry, rendering it.
 * Only *branching* on it is forbidden, because only branching changes behaviour.
 *
 * Opt out where the error is genuinely one you constructed and named yourself:
 *   // eslint-disable-next-line house/no-error-name-branching -- <why>
 */
import { sep } from "node:path";
import { appRelative } from "../_app-path.js";

const SCRIPTS_PREFIX = `scripts${sep}`;
const ESLINT_RULES_PREFIX = `eslint-rules${sep}`;
const TEST_SEGMENTS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
/** Matching with the name as RECEIVER, e.g. `name.startsWith("Callback")`. */
const RECEIVER_METHODS = new Set(["startsWith", "endsWith", "includes", "match", "search"]);
/**
 * Matching with the name as ARGUMENT — the inverted shape, e.g.
 * `/^Credentials/.test(err.name)` or `KNOWN_NAMES.includes(err.name)`.
 */
const ARGUMENT_METHODS = new Set(["test", "includes", "indexOf", "has"]);

/** Strip the wrappers that sit between a comparison and the identifier underneath. */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "ChainExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    current = current.expression;
  }
  return current;
}

/** True when `node` reads the property `key` — `a.key`, `a?.key`, `a["key"]`. */
function readsProperty(node, key) {
  const inner = unwrap(node);
  if (inner?.type !== "MemberExpression") return null;
  const { property, computed } = inner;
  const matches = computed
    ? property.type === "Literal" && property.value === key
    : property.type === "Identifier" && property.name === key;
  return matches ? inner : null;
}

/**
 * True for `<caught>.name`, and for `<caught>.constructor.name` — the most
 * literal restatement of the bug, since `name` is derived from exactly that.
 */
function isNameMemberOf(node, isCaughtError) {
  const member = readsProperty(node, "name");
  if (!member) return false;
  const object = unwrap(member.object);
  if (isCaughtError(object)) return true;
  const ctor = readsProperty(object, "constructor");
  return Boolean(ctor) && isCaughtError(unwrap(ctor.object));
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Never branch on a caught error's `.name` — it is minified in production.",
      owner: "security",
      lesson: "2026-09-19",
    },
    schema: [],
    messages: {
      noErrorNameBranching:
        "Branching on a caught error's `.name` is unreliable: `name` comes from the class name, " +
        'which the production minifier rewrites (`err.name` is `"l"` in a built bundle), so this ' +
        "branch passes in dev and silently fails in production. Compare a literal-valued property " +
        "instead — `err.type` for Auth.js errors, `err.code` for AppError and Postgres — or use " +
        "`err instanceof SomeError`. If you constructed and named this error yourself, opt out with " +
        "`// eslint-disable-next-line house/no-error-name-branching -- <why>`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";

    // Path gate first: this only matters in code that gets bundled and minified.
    if (appRelative(filename).startsWith(SCRIPTS_PREFIX)) return {};
    if (filename.includes(ESLINT_RULES_PREFIX)) return {};
    if (TEST_SEGMENTS.some((segment) => filename.includes(segment))) return {};
    if (!filename.includes(`src${sep}`) && !filename.startsWith("src/")) return {};

    /** Identifiers bound by `catch (err)`. */
    const caught = new Set();
    /** Locals initialised from a caught error's `.name`, e.g. `const name = err.name;`. */
    const aliases = new Set();

    const isCaughtError = (node) => node?.type === "Identifier" && caught.has(node.name);
    const isAlias = (node) => node?.type === "Identifier" && aliases.has(node.name);

    /**
     * `catch ({ name })` / `const { name: n } = err` — pull the local that the
     * `name` property lands in and treat it as an alias from there on.
     */
    const collectNameAliases = (pattern) => {
      for (const prop of pattern.properties) {
        if (prop.type !== "Property" || prop.computed) continue;
        const key = prop.key;
        const isNameKey =
          (key.type === "Identifier" && key.name === "name") ||
          (key.type === "Literal" && key.value === "name");
        if (!isNameKey) continue;
        // `{ name }` and `{ name: alias }`; a nested pattern has no identifier
        // to track, and `{ name = "x" }` lands in an AssignmentPattern.
        const target = prop.value.type === "AssignmentPattern" ? prop.value.left : prop.value;
        if (target.type === "Identifier") aliases.add(target.name);
      }
    };

    /** The thing we refuse to branch on: `err.name`, or a local standing in for it. */
    const isErrorName = (node) => {
      const inner = unwrap(node);
      return isAlias(inner) || isNameMemberOf(node, isCaughtError);
    };

    return {
      CatchClause(node) {
        // `catch (err)`. `catch ({ name })` destructures straight to an alias;
        // `catch {}` has no binding at all.
        if (node.param?.type === "Identifier") caught.add(node.param.name);
        else if (node.param?.type === "ObjectPattern") collectNameAliases(node.param);
      },

      // `const name = (err as {...} | null)?.name;` — the indirection that hid
      // the original bug. Declarators are visited before the code that uses them.
      VariableDeclarator(node) {
        if (!node.init) return;
        // `const { name } = err as Error;`
        if (node.id.type === "ObjectPattern") {
          if (isCaughtError(unwrap(node.init))) collectNameAliases(node.id);
          return;
        }
        if (node.id.type !== "Identifier") return;
        // `const e = err;` — follow the chain so a second hop stays covered.
        if (isCaughtError(unwrap(node.init))) {
          caught.add(node.id.name);
          return;
        }
        if (isNameMemberOf(node.init, isCaughtError)) aliases.add(node.id.name);
      },

      // `err.name === "CredentialsSignin"`, and the membership form
      // `err.name in RETRYABLE` — the same table lookup as `.includes`, written
      // with an operator instead of a method.
      BinaryExpression(node) {
        if (node.operator === "in") {
          if (isErrorName(node.left)) {
            context.report({ node, messageId: "noErrorNameBranching" });
          }
          return;
        }
        if (!EQUALITY_OPERATORS.has(node.operator)) return;
        if (isErrorName(node.left) || isErrorName(node.right)) {
          context.report({ node, messageId: "noErrorNameBranching" });
        }
      },

      // `MESSAGES[err.name] ?? fallback` — keying a table on the name is a
      // branch with the `if` spelled as a lookup, and it fails the same way:
      // in a built bundle the key is `"l"`, every request takes the fallback.
      MemberExpression(node) {
        if (!node.computed) return;
        if (isErrorName(node.property)) {
          context.report({ node: node.property, messageId: "noErrorNameBranching" });
        }
      },

      // Three jobs, one visitor — ESLint takes a single handler per node type.
      //   1. `promise.catch((err) => ...)` binds a caught error.
      //   2. `name?.startsWith("CallbackRouteError")` — name as receiver.
      //   3. `/^Credentials/.test(err.name)` — name as argument.
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee?.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        const method = callee.property.name;

        // A rejection handler's parameter is a caught error too — extracting
        // this mapping into one is the likeliest way the original code gets
        // refactored out from under the rule.
        if (method === "catch") {
          const handler = node.arguments[0];
          const isFn =
            handler?.type === "ArrowFunctionExpression" || handler?.type === "FunctionExpression";
          if (isFn) {
            const param = handler.params[0];
            if (param?.type === "Identifier") caught.add(param.name);
            else if (param?.type === "ObjectPattern") collectNameAliases(param);
          }
          return;
        }

        if (RECEIVER_METHODS.has(method) && isErrorName(callee.object)) {
          context.report({ node, messageId: "noErrorNameBranching" });
          return;
        }
        if (ARGUMENT_METHODS.has(method) && node.arguments.some(isErrorName)) {
          context.report({ node, messageId: "noErrorNameBranching" });
        }
      },

      // `switch (err.name) { ... }`
      SwitchStatement(node) {
        if (isErrorName(node.discriminant)) {
          context.report({ node: node.discriminant, messageId: "noErrorNameBranching" });
        }
      },
    };
  },
};

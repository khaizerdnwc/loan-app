import { type Rule, RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";
import noDangerousHtmlWithoutSanitize from "../src/rules/no-dangerous-html-without-sanitize.js";
import noErrorNameBranching from "../src/rules/no-error-name-branching.js";

// ESLint's RuleTester drives the host test runner. Vitest runs with globals: false, so
// wire the hooks explicitly. Ported from nxlvl with their original cases; filenames are
// package-relative ("src/..."), which the _app-path shim maps for every package.
/** The rules are plain JS; their inferred literal types are narrower than ESLint's. */
const asRule = (rule: unknown) => rule as Rule.RuleModule;

// The static hooks exist at runtime but not in ESLint's type definitions.
const hooks = RuleTester as unknown as Record<"afterAll" | "describe" | "it" | "itOnly", unknown>;
hooks.afterAll = afterAll;
hooks.describe = describe;
hooks.it = it;
hooks.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("no-dangerous-html-without-sanitize", asRule(noDangerousHtmlWithoutSanitize), {
  valid: [
    {
      filename: "src/features/feed/components/post.tsx",
      code: "const a = <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;",
    },
    {
      filename: "src/features/feed/components/post.tsx",
      code: "const a = <div dangerouslySetInnerHTML={{ __html: html.sanitizeHtmlStrict(raw) }} />;",
    },
    { filename: "src/features/feed/components/post.tsx", code: "const a = <div>{raw}</div>;" },
  ],
  invalid: [
    {
      filename: "src/features/feed/components/post.tsx",
      code: "const a = <div dangerouslySetInnerHTML={{ __html: raw }} />;",
      errors: [{ messageId: "unsanitized" }],
    },
    // A string transform is not a sanitizer.
    {
      filename: "src/features/feed/components/post.tsx",
      code: 'const a = <div dangerouslySetInnerHTML={{ __html: raw.replace(/</g, "") }} />;',
      errors: [{ messageId: "unsanitized" }],
    },
    // A pre-built object hides what __html is, so it cannot be verified.
    {
      filename: "src/features/feed/components/post.tsx",
      code: "const a = <div dangerouslySetInnerHTML={markup} />;",
      errors: [{ messageId: "unsanitized" }],
    },
  ],
});

ruleTester.run("no-error-name-branching", asRule(noErrorNameBranching), {
  valid: [
    // The fix: `type` is a static string literal, untouched by the minifier.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch (err) {
  const type = (err as { type?: string } | null)?.type;
  if (type === "CredentialsSignin" || type === "CallbackRouteError") {
    throw new AppError("UNAUTHORIZED", "Invalid username or password.");
  }
  throw err;
}`,
    },
    // Class identity survives renaming, so instanceof is always fine.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch (err) {
  if (err instanceof AuthError) throw new AppError("UNAUTHORIZED", "Invalid.");
  throw err;
}`,
    },
    // READING .name is fine — only branching on it changes behaviour.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await run();
} catch (err) {
  logger.error({ name: (err as Error).name }, "failed");
  throw err;
}`,
    },
    // A `.name` that never came from a caught error is unrelated.
    {
      filename: "src/features/tournaments/server/queries.ts",
      code: `const team = await getTeam();
if (team.name === "Cloud9") return true;`,
    },
    // `in` with the name on the RIGHT is a plain property probe on the error
    // object, not a branch on the minified class name.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `try {
  await put(key, body);
} catch (err) {
  if ("name" in (err as object)) logger.warn(err);
  throw err;
}`,
    },
    // The documented opt-out. RuleTester registers the rule under its own
    // `rule-to-test/` prefix, so the directive here names that id; in the app
    // the comment reads `house/no-error-name-branching`.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `
        try {
          await put(key, body);
        } catch (err) {
          // eslint-disable-next-line rule-to-test/no-error-name-branching -- we threw and named this one ourselves
          if ((err as Error).name === "LocalRetryable") return null;
          throw err;
        }
      `,
    },
    // Outside the path gate: test files may assert on a minified name on purpose.
    {
      filename: "src/features/auth/__tests__/signin.test.ts",
      code: `try {
  await signInAction(input);
} catch (err) {
  const name = (err as Error).name;
  if (name === "CredentialsSignin") throw err;
}`,
    },
  ],
  invalid: [
    // The exact shape that shipped: aliased through a local, then compared.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch (err) {
  const name = (err as { name?: string } | null)?.name;
  if (name === "CredentialsSignin" || name?.startsWith("CallbackRouteError")) {
    throw new AppError("UNAUTHORIZED", "Invalid username or password.");
  }
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }, { messageId: "noErrorNameBranching" }],
    },
    // Compared directly off the caught binding.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `try {
  await put(key, body);
} catch (err) {
  if ((err as Error).name === "AbortError") return null;
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // switch on the discriminant.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `try {
  await put(key, body);
} catch (err) {
  switch (err.name) {
    case "AbortError":
      return null;
    default:
      throw err;
  }
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // Inverted shape: the name is the ARGUMENT, not the receiver.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `try {
  await put(key, body);
} catch (err) {
  if (/^Abort/.test((err as Error).name)) return null;
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    {
      filename: "src/features/storage/server/upload.ts",
      code: `const RETRYABLE = ["AbortError", "TimeoutError"];
try {
  await put(key, body);
} catch (err) {
  const name = (err as Error).name;
  if (RETRYABLE.includes(name)) return null;
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // Destructured out of the catch binding — the likeliest rewrite.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch ({ name }) {
  if (name === "CredentialsSignin") throw new AppError("UNAUTHORIZED", "Invalid.");
  throw new Error("unreachable");
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // Destructured in a declarator, renamed on the way out.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch (err) {
  const { name: kind } = err as Error;
  if (kind === "CredentialsSignin") throw new AppError("UNAUTHORIZED", "Invalid.");
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // `constructor.name` — the most literal restatement of the bug.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `try {
  await signIn("credentials", creds);
} catch (err) {
  if (err.constructor.name === "CredentialsSignin") {
    throw new AppError("UNAUTHORIZED", "Invalid.");
  }
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // A rejection handler's parameter is a caught error too.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `await put(key, body).catch((err) => {
  if ((err as Error).name === "AbortError") return null;
  throw err;
});`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // Two-hop alias chain: `const e = err; const n = e.name;`
    {
      filename: "src/features/storage/server/upload.ts",
      code: `try {
  await put(key, body);
} catch (err) {
  const e = err;
  const n = (e as Error).name;
  if (n === "AbortError") return null;
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // Membership via the operator rather than `.includes`.
    {
      filename: "src/features/storage/server/upload.ts",
      code: `const RETRYABLE = { AbortError: true, TimeoutError: true };
try {
  await put(key, body);
} catch (err) {
  if ((err as Error).name in RETRYABLE) return null;
  throw err;
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
    // The branch spelled as a table lookup: in a built bundle the key is "l",
    // so every caller silently takes the fallback.
    {
      filename: "src/features/auth/server/actions.ts",
      code: `const MESSAGES: Record<string, string> = { CredentialsSignin: "Invalid username or password." };
try {
  await signIn("credentials", creds);
} catch (err) {
  const name = (err as Error).name;
  throw new AppError("UNAUTHORIZED", MESSAGES[name] ?? "Internal server error");
}`,
      errors: [{ messageId: "noErrorNameBranching" }],
    },
  ],
});

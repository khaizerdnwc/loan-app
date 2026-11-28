/**
 * The one ESLint config for the whole workspace (ADR 0015). Biome handles general lint and
 * formatting; ESLint runs what Biome cannot: the house rules (packages/eslint-house), the
 * security plugin, and accessibility checks on the backoffice. The on-edit hook,
 * review:preflight, the pre-push gate and the pull request all run this file.
 *
 * Rules that would flag more than ten existing places when added start as "warn" and are
 * promoted once those places are fixed (ADR 0015).
 */
import house from "@loan/eslint-house";
import jsxA11y from "eslint-plugin-jsx-a11y";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      "**/playwright-report/**",
      "**/test-results/**",
      ".claude/worktrees/**",
      "packages/eslint-house/test/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    linterOptions: { reportUnusedDisableDirectives: "error" },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { house, security },
    rules: {
      // All code
      "house/no-commented-out-code": "error",
      "house/no-todo-comment": "error",
      // security
      "house/no-console-in-server": "error",
      "house/no-math-random-in-server": "error",
      "house/no-money-parse-in-controller": "error",
      "house/no-process-env-outside-config": "error",
      "house/require-roles-on-controller-handler": "error",
      "house/no-server-env-in-client": "error",
      "house/require-shape-with-validate-nested": "error",
      "house/no-dangerous-html-without-sanitize": "error",
      "house/no-error-name-branching": "error",
      // data
      "house/no-float-money": "error",
      "house/no-datasource-outside-repository": "error",
      "house/no-typeorm-synchronize": "error",
      "house/require-order-with-take": "error",
      "house/no-provider-call-in-transaction": "error",
      // architecture
      "house/no-provider-import-outside-adapters": "error",
      "house/no-case-status-assignment-outside-lifecycle": "error",
      // qa
      "house/no-status-only-assertion": "error",
      // ui-ux
      "house/no-raw-colour": "error",
      "house/money-through-formatter": "error",
      "house/no-ring-color-without-width": "error",
      "house/text-size-before-leading": "error",
      "house/no-arbitrary-text-size": "error",
      "house/no-title-on-disabled-control": "error",
      "house/require-label-in-name": "error",
      "house/problem-code-through-constant": "error",
      "house/money-column-numeric": "error",
      "house/no-reason-code-literal": "error",
      "house/no-engine-version-literal": "error",
      // eslint-plugin-security: the generic Node security checks.
      "security/detect-eval-with-expression": "error",
      "security/detect-child-process": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-buffer-noassert": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-possible-timing-attacks": "error",
      "security/detect-bidi-characters": "error",
      // Too noisy for typed code: every obj[key] lookup.
      "security/detect-object-injection": "off",
    },
  },
  {
    // Tooling and gate scripts legitimately spawn processes and read files by path, and
    // their regexes run over repo files, never over user input (nxlvl never linted these
    // folders with the security plugin at all).
    files: ["tools/**", "scripts/**", "packages/eslint-house/**", "**/*.config.{ts,js,mjs}"],
    rules: {
      "security/detect-child-process": "off",
      "security/detect-non-literal-require": "off",
      "security/detect-unsafe-regex": "off",
    },
  },
  {
    // Accessibility on the screens staff use all day.
    files: ["apps/backoffice/src/**/*.tsx", "packages/ui/src/**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
);

/**
 * Paths for house rules, anchored on where this package lives — not on process.cwd(), so
 * a rule gives the same answer from CI, the on-edit hook, preflight and an editor opened
 * anywhere in the repo.
 *
 * Not a rule: files starting with `_` are skipped by the registry check.
 */
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root: packages/eslint-house/src/.. /.. /.. */
export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** `filename` relative to the repository root, with `/` separators. */
export function repoRelative(filename) {
  return relative(REPO_ROOT, resolve(filename)).split(sep).join("/");
}

/**
 * `filename` relative to the workspace package that owns it — `src/x/y.ts` for
 * `apps/backoffice/src/x/y.ts` or `packages/ui/src/x/y.ts`. Rules ported from nxlvl gate on
 * a leading `src/`; this keeps that gate meaningful in every package. Returned with the
 * platform separator, as those rules expect.
 */
export function appRelative(filename) {
  const rel = repoRelative(filename).replace(/^(apps|packages|tools)\/[^/]+\//, "");
  return rel.split("/").join(sep);
}

const TEST_FILE = /(\.test\.tsx?|\.spec\.tsx?|\.e2e-spec\.ts)$/;

export function isTestFile(rel) {
  return TEST_FILE.test(rel) || /(^|\/)(test|__tests__|e2e)\//.test(rel);
}

/** Server-side code: the API and the packages it is built from. */
export function isServerCode(rel) {
  return /^(apps\/api\/src|packages\/(base|core|contracts)\/src)\//.test(rel) && !isTestFile(rel);
}

/** Browser-facing code: the backoffice and the shared UI package. */
export function isWebCode(rel) {
  return /^(apps\/backoffice\/src|packages\/ui\/src)\//.test(rel) && !isTestFile(rel);
}

/** Any product source file (not tooling, not tests). */
export function isProductCode(rel) {
  return (
    /^(apps|packages)\/[^/]+\/src\//.test(rel) &&
    !rel.startsWith("packages/eslint-house/") &&
    !isTestFile(rel)
  );
}

/** The context's filename across ESLint versions. */
export function filenameOf(context) {
  return context.filename ?? context.getFilename?.() ?? "";
}

/**
 * Shared plumbing for the /review tooling (ADR 0016, ADR 0017): which diff is under review,
 * which files it changed, and which role reviewers own those files.
 *
 * The path→role table is code, so `pnpm review:roles`, `pnpm review:ack` and the /review
 * skill all agree on who reviews what.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesAny } from "./_lessons";

export const ROLES = ["security", "ui-ux", "data", "architecture", "qa", "devops"] as const;
export type Role = (typeof ROLES)[number];

/** Repo-relative globs per role. Keep in step with each `<role>-conventions` skill's `paths:`. */
export const ROLE_PATHS: Record<Role, readonly string[]> = {
  security: [
    "packages/base/src/auth/**",
    "**/*.guard.ts",
    "**/*.controller.ts",
    "**/*.decorator.ts",
    "**/dto/**",
    "apps/api/src/main.ts",
    "apps/api/src/config/**",
    "apps/backoffice/src/lib/{api,auth,session}*/**",
    "apps/backoffice/src/lib/{api,auth,session}*.ts",
    "apps/backoffice/src/middleware.ts",
  ],
  "ui-ux": ["apps/backoffice/src/**/*.tsx", "apps/backoffice/src/**/*.css", "packages/ui/**"],
  data: [
    "**/entities/**",
    "**/*.entity.ts",
    "**/migrations/**",
    "**/*.repository.ts",
    "packages/base/src/database/**",
    "packages/base/src/seed/**",
    // Money and the schedule are data correctness: a centavo out of place is a data bug.
    "packages/core/src/money/**",
  ],
  architecture: [
    "packages/contracts/**",
    "**/*.module.ts",
    "apps/api/src/adapters/**",
    "packages/*/src/index.ts",
    "packages/*/package.json",
    "apps/*/package.json",
  ],
  qa: [
    "**/__tests__/**",
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.e2e-spec.ts",
    "apps/backoffice/e2e/**",
    "docs/ACCEPTANCE.md",
    // Behaviour lives here: coverage is always in question when it changes.
    "packages/base/src/**",
  ],
  devops: [
    ".github/**",
    "**/Dockerfile",
    "docker-compose*.yml",
    "turbo.json",
    "pnpm-workspace.yaml",
    "package.json",
    // The one gate (ADR 0018, ADR 0021): what pre-push and CI run.
    "scripts/verify/**",
    "lefthook.yml",
    "apps/backoffice/next.config.ts",
    "**/.env.example",
  ],
};

/**
 * Map changed files to the roles that review them. `newFeatureDirs` are module or package
 * folders that do not exist at the base of the diff: a new module is always an
 * architecture contribution, whatever files it holds.
 */
export function reviewRoles(
  files: readonly string[],
  newFeatureDirs: readonly string[] = [],
): Map<Role, string[]> {
  const out = new Map<Role, string[]>();
  for (const role of ROLES) {
    const mine = files.filter(
      (f) =>
        matchesAny(f, ROLE_PATHS[role]) ||
        (role === "architecture" && newFeatureDirs.some((d) => f.startsWith(`${d}/`))),
    );
    if (mine.length) out.set(role, mine);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Git

export function git(root: string, args: string[]): string {
  // quotePath=false: non-ASCII paths come back as-is, not as quoted octal escapes.
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : "";
}

export interface DiffSpec {
  label: string;
  diffArgs: string[];
}

/**
 * The diff under review: the argument if given; otherwise the working tree against HEAD
 * (untracked files count), then the staged diff, then the branch against origin/main.
 */
export function resolveDiff(root: string, arg: string | undefined): DiffSpec {
  if (arg?.startsWith("-") && arg !== "--cached") {
    console.error(`review: unknown option "${arg}" — use --cached or a base ref`);
    process.exit(2);
  }
  const candidates: DiffSpec[] = arg
    ? [{ label: arg, diffArgs: arg === "--cached" ? ["--cached"] : [arg] }]
    : [
        { label: "working tree vs HEAD", diffArgs: ["HEAD"] },
        { label: "--cached", diffArgs: ["--cached"] },
        { label: "origin/main...HEAD", diffArgs: ["origin/main...HEAD"] },
      ];
  for (const c of candidates) {
    if (git(root, ["diff", "--name-only", ...c.diffArgs]).trim()) return c;
    if (
      c.label === "working tree vs HEAD" &&
      git(root, ["ls-files", "--others", "--exclude-standard"]).trim()
    ) {
      return c;
    }
  }
  return candidates[candidates.length - 1] as DiffSpec;
}

/** Changed, non-deleted files of a diff, repo-relative. Untracked files join a working-tree diff. */
export function changedFiles(root: string, spec: DiffSpec): string[] {
  const untracked =
    spec.label === "working tree vs HEAD"
      ? git(root, ["ls-files", "--others", "--exclude-standard"])
      : "";
  return [
    ...new Set(
      `${git(root, ["diff", "--name-only", "--diff-filter=d", ...spec.diffArgs])}\n${untracked}`
        .split("\n")
        .filter(Boolean),
    ),
  ];
}

/** The fingerprint the commit lock compares: `git diff <spec> | git hash-object --stdin`. */
export function hashDiff(root: string, spec: DiffSpec): string {
  return spawnSync("git", ["hash-object", "--stdin"], {
    cwd: root,
    input: git(root, ["diff", ...spec.diffArgs]),
    encoding: "utf8",
  }).stdout.trim();
}

/** The tree the diff is measured against: HEAD, or the merge base for `a...b`. */
export function baseRef(spec: DiffSpec): string {
  const arg = spec.diffArgs[0] ?? "HEAD";
  if (arg === "--cached" || arg === "HEAD") return "HEAD";
  return arg.includes("...") ? (arg.split("...")[0] as string) : arg;
}

/** Feature modules and workspace packages the diff adds — absent at the base of the diff. */
export const NEW_DIR_PATTERNS: readonly RegExp[] = [
  /^(packages\/base\/src\/[^/]+)\//,
  /^(apps\/api\/src\/adapters\/[^/]+)\//,
  /^(packages\/[^/]+)\//,
  /^(apps\/[^/]+)\//,
];

export function newFeatureDirs(root: string, spec: DiffSpec, files: readonly string[]): string[] {
  const dirs = new Set(
    files.flatMap((f) =>
      NEW_DIR_PATTERNS.map((re) => re.exec(f)?.[1]).filter((d): d is string => Boolean(d)),
    ),
  );
  const base = baseRef(spec);
  return [...dirs].filter((d) => !git(root, ["ls-tree", "-d", base, d]).trim());
}

export function reviewDir(root: string): string {
  return join(root, ".claude", ".review");
}

// ---------------------------------------------------------------------------
// Workspace packages

/** The workspace package directory that owns a repo-relative file, or null for root files. */
export function packageDirOf(file: string): string | null {
  const m = /^((?:apps|packages|tools)\/[^/]+)\//.exec(file);
  return m ? (m[1] as string) : null;
}

export interface WorkspacePackage {
  dir: string;
  name: string;
  runner: "jest" | "vitest" | null;
}

export function readPackage(repoRoot: string, dir: string): WorkspacePackage | null {
  const manifest = join(repoRoot, dir, "package.json");
  if (!existsSync(manifest)) return null;
  const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
  if (!name) return null;
  const has = (f: string) => existsSync(join(repoRoot, dir, f));
  const runner =
    has("jest.config.ts") || has("jest.config.js")
      ? "jest"
      : has("vitest.config.ts") || has("vitest.config.mts")
        ? "vitest"
        : null;
  return { dir, name, runner };
}

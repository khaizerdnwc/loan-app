/**
 * The check registry (ADR 0016): deterministic gates for lessons ESLint cannot express —
 * anything that needs more than one file's syntax tree, or a file ESLint does not parse
 * (SQL, JSON, a Dockerfile, a Markdown table). `pnpm house:check` runs every check here.
 *
 * Adding one is a file `tools/review/src/checks/<id>.ts` whose default export is a
 * `HouseCheck`, plus a case in `tools/review/test/checks.test.ts`. When a check gates a lesson, name the
 * lesson id in `lesson` and put `Gate: check:<id>` under that lesson's log heading.
 *
 * Waivers: a finding can be silenced where it occurs with a line directly above it —
 *   -- house-check-disable-next <id>: <why this one is deliberate>
 * (`//` or `#` also work). The line must BEGIN with the comment marker, so a trailing
 * comment or a JSON string cannot waive. A waiver without a reason is itself a finding.
 * Findings without a line number (whole-file facts) cannot be waived at all. Waived
 * findings are counted in the output, never dropped silently.
 *
 * Two invariants for check modules:
 * - Import-safe without `.claude/`: every module is imported before `devOnly` is applied,
 *   so a check that imports something absent from the Docker image fails the deploy.
 * - `devOnly` unless the check protects the deployed artifact. Convention and
 *   documentation drift is CI's job, never a hotfix's blocker.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export interface Finding {
  /** Repo-relative path. */
  file: string;
  line?: number;
  message: string;
}

export interface CheckContext {
  repoRoot: string;
  /** False in the Docker build context (no `.claude/`): `devOnly` checks are skipped. */
  fullCheckout: boolean;
}

export interface HouseCheck {
  id: string;
  /** The lesson this check gates, if any. */
  lesson?: string;
  description: string;
  /**
   * Skipped where `.claude/` is absent — the Docker build, whose `.dockerignore` drops it —
   * so a development gate never fails a deploy. See the header for when to set it.
   */
  devOnly?: boolean;
  run(ctx: CheckContext): Finding[] | Promise<Finding[]>;
}

const WAIVER = /^(?:--|\/\/|#)\s*house-check-disable-next\s+([a-z0-9-]+)(?::\s*(.*))?$/;

/**
 * Drop findings waived by a `house-check-disable-next <id>: <reason>` on the line above,
 * and report waivers that give no reason.
 */
export function applyWaivers(
  id: string,
  findings: Finding[],
  repoRoot: string,
): { kept: Finding[]; waived: number } {
  const cache = new Map<string, string[]>();
  const lines = (file: string) => {
    if (!cache.has(file)) {
      const abs = join(repoRoot, file);
      cache.set(file, existsSync(abs) ? readFileSync(abs, "utf8").split("\n") : []);
    }
    return cache.get(file) as string[];
  };
  const out: Finding[] = [];
  let waived = 0;
  for (const f of findings) {
    const above = f.line && f.line > 1 ? (lines(f.file)[f.line - 2] ?? "") : "";
    const m = WAIVER.exec(above.trim());
    if (m && m[1] === id) {
      if (!m[2]?.trim()) {
        out.push({ ...f, line: (f.line ?? 1) - 1, message: `waiver for ${id} gives no reason` });
      } else {
        waived++;
      }
      continue;
    }
    out.push(f);
  }
  return { kept: out, waived };
}

export async function loadChecks(dir: string): Promise<HouseCheck[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .sort();
  const checks: HouseCheck[] = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const check = mod.default as HouseCheck | undefined;
    if (!check?.id || typeof check.run !== "function") {
      throw new Error(`tools/review/src/checks/${f} must default-export a HouseCheck`);
    }
    if (`${check.id}.ts` !== f) {
      throw new Error(
        `tools/review/src/checks/${f} declares id "${check.id}"; the file must be named after it`,
      );
    }
    checks.push(check);
  }
  return checks;
}

export async function runChecks(
  checks: HouseCheck[],
  ctx: CheckContext,
): Promise<{ id: string; findings: Finding[]; waived: number }[]> {
  const results = [];
  for (const c of checks) {
    if (c.devOnly && !ctx.fullCheckout) continue;
    const raw = await c.run(ctx);
    const { kept, waived } = applyWaivers(c.id, raw, ctx.repoRoot);
    results.push({ id: c.id, findings: kept, waived });
  }
  return results;
}

/** Helpers shared by checks. */
export const rel = (ctx: CheckContext, abs: string) => relative(ctx.repoRoot, abs);
export const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
export const checksDir = (repoRoot: string) => join(repoRoot, "tools", "review", "src", "checks");

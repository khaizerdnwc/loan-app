/**
 * Lessons ledger — the parsing and validation behind `pnpm lessons` and the
 * lessons half of `pnpm house:check` (ADR 0016).
 *
 * Each role keeps two files under `.claude/skills/<role>-conventions/`:
 *
 *   lessons.md      LOADED. One ungated lesson per line, path-tagged, budgeted:
 *                   - [<id>] paths: <glob>, <glob> · shape: <shape> · <instruction>. Check: <what to look at>.
 *   lessons-log.md  NEVER LOADED. The full narrative of every lesson under `## <id>`,
 *                   with a `Gate: house/<rule>` line once a rule enforces it.
 *
 * A lesson's state is derived, never declared twice: a line in lessons.md means
 * prose; a `Gate:` line in the log (`house/<rule>`, `check:<id>`, or a named test) means a
 * machine enforces it, so it must NOT
 * also be in lessons.md; neither means retired.
 *
 * Everything here is deterministic and dependency-free — it runs in CI and in a
 * PostToolUse hook, and Node 22.0 (the engines floor) has no path.matchesGlob.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const LESSONS_BUDGET_BYTES = 8_000;
export const MEMORY_INDEX_BUDGET_BYTES = 4_000;
export const MAX_ENTRY_CHARS = 320;
/** A lesson that applies everywhere is paid for on every edit, so it costs triple. */
export const WILDCARD_WEIGHT = 3;

export const SHAPES = ["lint-candidate", "check-candidate", "test-candidate", "judgment"] as const;
export type Shape = (typeof SHAPES)[number];

export interface Lesson {
  id: string;
  role: string;
  paths: string[];
  shape: Shape;
  text: string;
  line: number;
  raw: string;
}

export interface LogEntry {
  id: string;
  role: string;
  gate: string | null;
  body: string;
  line: number;
}

export interface RoleLedger {
  role: string;
  lessonsPath: string;
  logPath: string;
  lessons: Lesson[];
  log: LogEntry[];
  /** Grammar errors found while parsing lessons.md, as `line: message`. */
  parseErrors: string[];
  bytes: number;
  weightedBytes: number;
}

// ---------------------------------------------------------------------------
// Locations

/** The workspace root: the nearest ancestor holding pnpm-workspace.yaml. */
export function findRepoRoot(from = process.cwd()): string {
  let dir = resolve(from);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
  return dir;
}

export function skillsDir(root: string): string {
  return join(root, ".claude", "skills");
}

/** False inside the Docker build context, where .dockerignore drops `.claude`. */
export function hasTooling(root: string): boolean {
  return existsSync(skillsDir(root));
}

export function listRoles(root: string): string[] {
  return readdirSync(skillsDir(root))
    .filter((d) => d.endsWith("-conventions"))
    .filter((d) => statSync(join(skillsDir(root), d)).isDirectory())
    .map((d) => d.slice(0, -"-conventions".length))
    .sort();
}

/**
 * Accept a path the way a person or a tool will type it — absolute, repo-relative,
 * or relative to the current directory — and return it repo-relative.
 */
export function toRepoRelative(root: string, file: string): string {
  const rel = isAbsolute(file) ? relative(root, file) : file;
  const clean = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  if (existsSync(join(root, clean))) return clean;
  const top = clean.split("/")[0] ?? "";
  if (["apps", "packages", "tools", "scripts", "docs", ".github", ".claude"].includes(top))
    return clean;
  const viaApp = relative(root, resolve(process.cwd(), clean)).replace(/\\/g, "/");
  return viaApp.startsWith("..") ? clean : viaApp;
}

// ---------------------------------------------------------------------------
// Globs: `**` any depth, `*` within a segment, `?` one char, `{a,b}` either.

const globCache = new Map<string, RegExp>();

/** Split on commas that are not inside `{…}`, so `a/{x,y}/**, b/**` is two globs, not three. */
export function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of list) {
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const escapeRe = (c: string) => c.replace(/[.+^$()|[\]\\]/g, "\\$&");

function globBody(glob: string): string {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      // Find the matching close brace, so `{a,{b,c}}` and `{*.ts,*.tsx}` both work.
      let depth = 0;
      let close = -1;
      for (let j = i; j < glob.length; j++) {
        if (glob[j] === "{") depth++;
        else if (glob[j] === "}" && --depth === 0) {
          close = j;
          break;
        }
      }
      if (close < 0) {
        re += "\\{";
        continue;
      }
      const alts = splitTopLevel(glob.slice(i + 1, close));
      re += `(?:${alts.map(globBody).join("|")})`;
      i = close;
    } else {
      re += escapeRe(c);
    }
  }
  return re;
}

export function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const compiled = new RegExp(`^${globBody(glob)}$`);
  globCache.set(glob, compiled);
  return compiled;
}

export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}

// ---------------------------------------------------------------------------
// Parsing

const ENTRY = /^- \[([a-z0-9-]+)\] paths: (.+?) · shape: ([a-z-]+) · (.+)$/;

function idProblem(id: string, role: string): string | null {
  const rest = id.startsWith(`${role}-`) ? id.slice(role.length + 1) : null;
  if (rest === null) return `id "${id}" must start with "${role}-"`;
  if (!/^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rest)) {
    return `id "${id}" must be ${role}-YYYYMMDD-<kebab-slug>`;
  }
  return null;
}

export function parseLessons(
  role: string,
  source: string,
): { lessons: Lesson[]; errors: string[] } {
  const lessons: Lesson[] = [];
  const errors: string[] = [];
  source.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.startsWith("- ")) return; // headings, blank lines and the intro are free text
    const m = ENTRY.exec(raw);
    if (!m) {
      errors.push(
        `${line}: not a lesson line — expected "- [<id>] paths: <globs> · shape: <shape> · <text>"`,
      );
      return;
    }
    const [, id, pathList, shape, text] = m as unknown as [string, string, string, string, string];
    const bad = idProblem(id, role);
    if (bad) errors.push(`${line}: ${bad}`);
    if (!(SHAPES as readonly string[]).includes(shape)) {
      errors.push(`${line}: shape "${shape}" is not one of ${SHAPES.join(", ")}`);
    }
    if (raw.length > MAX_ENTRY_CHARS) {
      errors.push(
        `${line}: ${raw.length} chars, over ${MAX_ENTRY_CHARS} — move the detail to the log`,
      );
    }
    const paths = splitTopLevel(pathList);
    if (paths.length === 0) errors.push(`${line}: no paths`);
    lessons.push({ id, role, paths, shape: shape as Shape, text, line, raw });
  });
  return { lessons, errors };
}

export function parseLog(role: string, source: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = source.split("\n");
  let current: { id: string; line: number; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const gateLine = current.body.find((l) => /^Gate:\s*/.test(l));
    const gate = gateLine ? gateLine.replace(/^Gate:\s*/, "").trim() : null;
    entries.push({
      id: current.id,
      role,
      gate,
      body: current.body.join("\n").trim(),
      line: current.line,
    });
  };
  lines.forEach((l, i) => {
    const m = /^## ([a-z0-9-]+)\s*$/.exec(l);
    if (m) {
      flush();
      current = { id: m[1] as string, line: i + 1, body: [] };
    } else if (current) {
      current.body.push(l);
    }
  });
  flush();
  return entries;
}

export function loadLedger(root: string, role: string): RoleLedger {
  const dir = join(skillsDir(root), `${role}-conventions`);
  const lessonsPath = join(dir, "lessons.md");
  const logPath = join(dir, "lessons-log.md");
  const source = existsSync(lessonsPath) ? readFileSync(lessonsPath, "utf8") : "";
  const logSource = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const { lessons, errors } = parseLessons(role, source);
  const bytes = Buffer.byteLength(source, "utf8");
  const extra = lessons
    .filter((l) => l.paths.includes("**"))
    .reduce((n, l) => n + Buffer.byteLength(l.raw, "utf8") * (WILDCARD_WEIGHT - 1), 0);
  return {
    role,
    lessonsPath,
    logPath,
    lessons,
    log: parseLog(role, logSource),
    parseErrors: errors,
    bytes,
    weightedBytes: bytes + extra,
  };
}

export function loadAllLedgers(root: string): RoleLedger[] {
  return listRoles(root).map((r) => loadLedger(root, r));
}

// ---------------------------------------------------------------------------
// Validation

/** House lint rules: one file per rule in the shared package both apps load. */
export const HOUSE_RULES_DIR = ["packages", "eslint-house", "src", "rules"] as const;
/** House checks: cross-file checks run by `pnpm house:check`. */
export const HOUSE_CHECKS_DIR = ["tools", "review", "src", "checks"] as const;

export function houseRuleNames(root: string): Set<string> {
  const dir = join(root, ...HOUSE_RULES_DIR);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".js") && f !== "index.js" && !f.startsWith("_"))
      .map((f) => f.slice(0, -3)),
  );
}

export function houseCheckNames(root: string): Set<string> {
  const dir = join(root, ...HOUSE_CHECKS_DIR);
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
      .map((f) => f.slice(0, -3)),
  );
}

/** Every problem across all roles, as `<file>:<line>: <message>`. Empty means valid. */
export function checkLedgers(root: string): string[] {
  const problems: string[] = [];
  const rules = houseRuleNames(root);
  const checks = houseCheckNames(root);
  const seen = new Map<string, string>();
  const rel = (p: string) => relative(root, p);

  for (const ledger of loadAllLedgers(root)) {
    const lp = rel(ledger.lessonsPath);
    const gp = rel(ledger.logPath);
    for (const e of ledger.parseErrors) problems.push(`${lp}:${e}`);

    if (ledger.weightedBytes > LESSONS_BUDGET_BYTES) {
      problems.push(
        `${lp}: ${ledger.weightedBytes} bytes (weighted) over the ${LESSONS_BUDGET_BYTES}-byte budget — ` +
          "promote a lesson to a gate, tighten its paths, or retire it to the log",
      );
    }

    const logById = new Map(ledger.log.map((e) => [e.id, e]));
    for (const l of ledger.lessons) {
      const where = `${lp}:${l.line}`;
      const prior = seen.get(l.id);
      if (prior) problems.push(`${where}: duplicate id "${l.id}" (also ${prior})`);
      seen.set(l.id, where);
      const logged = logById.get(l.id);
      if (!logged) problems.push(`${where}: "${l.id}" has no "## ${l.id}" section in ${gp}`);
      else if (logged.gate) {
        problems.push(
          `${where}: "${l.id}" is gated by ${logged.gate} — a gated lesson is not loaded; delete this line`,
        );
      }
    }

    const logSeen = new Set<string>();
    for (const e of ledger.log) {
      const where = `${gp}:${e.line}`;
      if (logSeen.has(e.id)) problems.push(`${where}: duplicate log section "${e.id}"`);
      logSeen.add(e.id);
      const bad = idProblem(e.id, ledger.role);
      if (bad) problems.push(`${where}: ${bad}`);
      if (e.gate) {
        for (const g of e.gate.split(",").map((s) => s.trim())) {
          const m = /^house\/([a-z0-9-]+)$/.exec(g);
          if (m && !rules.has(m[1] as string)) {
            problems.push(`${where}: Gate "${g}" names a rule that does not exist`);
          }
          const c = /^check:([a-z0-9-]+)$/.exec(g);
          if (c && !checks.has(c[1] as string)) {
            problems.push(
              `${where}: Gate "${g}" names a check that does not exist in tools/review/src/checks/`,
            );
          }
        }
      }
    }
  }

  const memoryDir = join(root, ".claude", "agent-memory");
  if (existsSync(memoryDir)) {
    for (const role of readdirSync(memoryDir)) {
      const index = join(memoryDir, role, "MEMORY.md");
      if (!existsSync(index)) continue;
      const size = statSync(index).size;
      if (size > MEMORY_INDEX_BUDGET_BYTES) {
        problems.push(
          `${rel(index)}: ${size} bytes over the ${MEMORY_INDEX_BUDGET_BYTES}-byte budget — ` +
            "this index auto-loads into every review; move detail into topic files",
        );
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Selection

/** The ungated lessons that apply to any of `files`, optionally for one role. */
export function lessonsFor(root: string, files: readonly string[], role?: string): Lesson[] {
  const targets = files.map((f) => toRepoRelative(root, f));
  const ledgers = role ? [loadLedger(root, role)] : loadAllLedgers(root);
  const out: Lesson[] = [];
  const seen = new Set<string>();
  for (const ledger of ledgers) {
    for (const l of ledger.lessons) {
      if (seen.has(l.id)) continue;
      if (targets.some((t) => matchesAny(t, l.paths))) {
        out.push(l);
        seen.add(l.id);
      }
    }
  }
  return out;
}

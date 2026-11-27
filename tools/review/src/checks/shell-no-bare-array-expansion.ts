/**
 * No bare "${array[@]}" in the repo's shell scripts.
 *
 * On macOS's bash 3.2, an empty array expanded as "${a[@]}" under `set -u` aborts the script
 * with "unbound variable". In verify.sh that aborted the static stage and, with the EXIT
 * trap reading $? as 0, reported the gate as passed (fixed in cabcddc). The same shape came
 * back within the hour in a new semgrep `roots` array, so the lesson
 * devops-20261127-shell-gate-fails-closed became this check.
 *
 * Use ${a[@]+"${a[@]}"} — it expands to nothing for an empty array on every bash. Any
 * other whole-array expansion is flagged, quoted or not and with or without an operator
 * ("${a[@]/x/y}", ${a[@]}, "${a[@]:-}"). Comment lines are ignored.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Finding, type HouseCheck, rel } from "./_registry";

/** Any expansion of a whole array: quoted or not, plain or with an operator (`/x/y`, `:n`). */
const ARRAY = /\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]([^}]*)\}/g;

/** Bare expansions in one script's text, with their line numbers. */
export function bareExpansions(text: string): { line: number; name: string }[] {
  const out: { line: number; name: string }[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("#")) return;
    for (const m of line.matchAll(ARRAY)) {
      const [, name, op = ""] = m;
      // Safe: ${a[@]+...} expands only when set. (${a[@]:-} is not: for an empty array it
      // yields one empty word, so a loop runs once with an empty value.)
      if (op.startsWith("+")) continue;
      const before = line.slice(0, m.index ?? 0);
      // The inner half of the safe form: ${name[@]+"${name[@]}"}
      if (before.endsWith(`\${${name}[@]+"`)) continue;
      out.push({ line: i + 1, name: name as string });
    }
  });
  return out;
}

function shellFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return shellFiles(path);
    return name.endsWith(".sh") ? [path] : [];
  });
}

const check: HouseCheck = {
  id: "shell-no-bare-array-expansion",
  lesson: "devops-20261127-shell-gate-fails-closed",
  description: 'no bare "${array[@]}" in scripts/ or .claude/hooks/ (bash 3.2 + set -u)',
  devOnly: true,
  run(ctx) {
    const files = [
      ...shellFiles(join(ctx.repoRoot, "scripts")),
      ...shellFiles(join(ctx.repoRoot, ".claude", "hooks")),
    ];
    return files.flatMap((file): Finding[] =>
      bareExpansions(readFileSync(file, "utf8")).map(({ line, name }) => ({
        file: rel(ctx, file),
        line,
        message: `bare "\${${name}[@]}" aborts on bash 3.2 under set -u when empty — write \${${name}[@]+"\${${name}[@]}"}`,
      })),
    );
  },
};

export default check;

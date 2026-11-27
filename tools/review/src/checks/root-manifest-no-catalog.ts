/**
 * The root package.json must not use `catalog:` specifiers.
 *
 * Dependabot resolves the root manifest without the workspace catalog, so a `catalog:`
 * there fails `--frozen-lockfile` on every Dependabot PR. Carried over from nxlvl, where
 * it was learned the hard way. Packages may use the catalog.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HouseCheck, lineOf, rel } from "./_registry";

const check: HouseCheck = {
  id: "root-manifest-no-catalog",
  description: "the root package.json has no catalog: specifiers",
  devOnly: true,
  run(ctx) {
    const path = join(ctx.repoRoot, "package.json");
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/"([^"]+)"\s*:\s*"catalog:[^"]*"/g)].map((m) => ({
      file: rel(ctx, path),
      line: lineOf(text, m.index ?? 0),
      message: `"${m[1]}" uses a catalog: specifier in the root manifest — Dependabot PRs then fail --frozen-lockfile; pin a range here`,
    }));
  },
};

export default check;

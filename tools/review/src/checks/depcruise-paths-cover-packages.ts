/**
 * Every workspace package with a src/index.ts is mapped to its source in
 * tsconfig.depcruise.json.
 *
 * dependency-cruiser excludes dist/ from the graph. A workspace import that is not mapped
 * resolves to packages/<x>/dist, is dropped, and every direction rule about that package
 * silently stops checking anything — which is how all the cross-package rules were blind
 * from the bootstrap until the engine review (lesson
 * architecture-20261127-depcruise-sees-workspace-edges).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HouseCheck, rel } from "./_registry";

const CONFIG = "tsconfig.depcruise.json";

/** The `paths` map of a tsconfig, tolerating a "//" comment key. */
export function depcruisePaths(json: string): Record<string, string[]> {
  const parsed = JSON.parse(json) as { compilerOptions?: { paths?: Record<string, string[]> } };
  return parsed.compilerOptions?.paths ?? {};
}

const check: HouseCheck = {
  id: "depcruise-paths-cover-packages",
  lesson: "architecture-20261127-depcruise-sees-workspace-edges",
  description: "every packages/*/src/index.ts is mapped to its source in tsconfig.depcruise.json",
  devOnly: true,
  run(ctx) {
    const packagesDir = join(ctx.repoRoot, "packages");
    const configPath = join(ctx.repoRoot, CONFIG);
    if (!existsSync(packagesDir)) return [];
    if (!existsSync(configPath)) {
      return [{ file: CONFIG, message: "missing: dependency-cruiser cannot see workspace edges" }];
    }
    const paths = depcruisePaths(readFileSync(configPath, "utf8"));
    return readdirSync(packagesDir).flatMap((dir) => {
      const index = `packages/${dir}/src/index.ts`;
      const manifest = join(packagesDir, dir, "package.json");
      if (!existsSync(join(ctx.repoRoot, index)) || !existsSync(manifest)) return [];
      const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (!name) return [];
      if ((paths[name] ?? []).includes(index)) return [];
      return [
        {
          file: rel(ctx, configPath),
          message: `${name} is not mapped to ${index}: its imports resolve to dist, which the graph excludes, so no dependency rule checks it — add "${name}": ["${index}"]`,
        },
      ];
    });
  },
};

export default check;

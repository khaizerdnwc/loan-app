/**
 * Every env var an app's config reads must be documented in that app's .env.example.
 *
 * Each app validates its environment in one file, `apps/<app>/src/config/env.ts` (the
 * only place `process.env` may be read: house/no-process-env-outside-config), as a Zod
 * object whose keys are the variable names. The .env.example next to it is what a person
 * or a deploy target reads to set the app up; if the two drift, the only record of a new
 * variable is the code that reads it.
 *
 * Commented-out keys count as documented: an optional variable is shown as `# KEY=`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HouseCheck, rel } from "./_registry";

/** The keys of the Zod object in env.ts: `  KEY: z.…` at the start of a line. */
export function envKeysFromSchema(source: string): string[] {
  return [...source.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:\s*z\b/gm)].map((m) => m[1] as string);
}

export function documentedKeys(example: string): Set<string> {
  return new Set(
    [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1] as string),
  );
}

const check: HouseCheck = {
  id: "env-example-parity",
  description: "every env var an app's src/config/env.ts reads is documented in its .env.example",
  devOnly: true,
  run(ctx) {
    const apps = join(ctx.repoRoot, "apps");
    if (!existsSync(apps)) return [];
    return readdirSync(apps).flatMap((app) => {
      const schema = join(apps, app, "src", "config", "env.ts");
      if (!existsSync(schema)) return [];
      const example = join(apps, app, ".env.example");
      if (!existsSync(example)) {
        return [{ file: rel(ctx, example), message: ".env.example is missing" }];
      }
      const documented = documentedKeys(readFileSync(example, "utf8"));
      return envKeysFromSchema(readFileSync(schema, "utf8"))
        .filter((key) => !documented.has(key))
        .sort()
        .map((key) => ({
          file: rel(ctx, example),
          message: `${key} is read by src/config/env.ts but absent here — add it with a comment saying what it is for`,
        }));
    });
  },
};

export default check;

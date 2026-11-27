/**
 * Every workspace package's package.json must be copied into the Dockerfile's deps stage.
 *
 * The deps stage copies manifests one by one (so the install layer caches), and
 * `pnpm install --frozen-lockfile` refuses a lockfile whose importers it can't see. A new
 * workspace package therefore breaks the image build while the other CI jobs stay green.
 * Carried over from nxlvl. Checks every Dockerfile in the repo that runs a frozen install.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HouseCheck, rel } from "./_registry";

/** Workspace package dirs from pnpm-workspace.yaml's `dir/*` globs (the only form it uses). */
export function workspacePackages(repoRoot: string): string[] {
  const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? "";
  const globs = [...block.matchAll(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1] ?? "");
  return globs.flatMap((glob) => {
    if (!glob.endsWith("/*")) return existsSync(join(repoRoot, glob, "package.json")) ? [glob] : [];
    const parent = glob.slice(0, -2);
    if (!existsSync(join(repoRoot, parent))) return [];
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(repoRoot, parent, d.name, "package.json")))
      .map((d) => `${parent}/${d.name}`);
  });
}

const check: HouseCheck = {
  id: "dockerfile-workspace-manifests",
  description:
    "every Dockerfile that runs a frozen pnpm install copies every workspace package.json",
  devOnly: true,
  run(ctx) {
    if (!existsSync(join(ctx.repoRoot, "pnpm-workspace.yaml"))) return [];
    const dockerfiles = [
      "Dockerfile",
      ...workspacePackages(ctx.repoRoot).map((d) => `${d}/Dockerfile`),
    ]
      .map((f) => join(ctx.repoRoot, f))
      .filter((f) => existsSync(f));
    return dockerfiles.flatMap((dockerfile) => {
      const text = readFileSync(dockerfile, "utf8");
      if (!/pnpm install[^\n]*--frozen-lockfile/.test(text)) return [];
      return findMissing(ctx, dockerfile, text);
    });
  },
};

function findMissing(ctx: Parameters<HouseCheck["run"]>[0], dockerfile: string, text: string) {
  return workspacePackages(ctx.repoRoot)
    .filter(
      (dir) =>
        !new RegExp(
          `^COPY\\s+(?:--\\S+\\s+)*${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/package\\.json\\s`,
          "m",
        ).test(text),
    )
    .map((dir) => ({
      file: rel(ctx, dockerfile),
      message: `${dir}/package.json is not copied in the deps stage — \`pnpm install --frozen-lockfile\` fails on the image build; add \`COPY ${dir}/package.json ./${dir}/\` before the install`,
    }));
}

export default check;

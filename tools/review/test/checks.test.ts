import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyWaivers,
  type CheckContext,
  checksDir,
  loadChecks,
  runChecks,
} from "../src/checks/_registry";
import architectureNamesBaseFolders from "../src/checks/architecture-names-base-folders";
import depcruisePathsCoverPackages from "../src/checks/depcruise-paths-cover-packages";
import dockerfileWorkspaceManifests from "../src/checks/dockerfile-workspace-manifests";
import envExampleParity from "../src/checks/env-example-parity";
import rootManifestNoCatalog from "../src/checks/root-manifest-no-catalog";
import shellNoBareArrayExpansion, {
  bareExpansions,
} from "../src/checks/shell-no-bare-array-expansion";

/** The repo root, from this file's own path (tools/review/test), whatever the working directory. */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

let root: string;
const write = (rel: string, content: string) => {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
};
const ctx = (): CheckContext => ({
  repoRoot: root,
  fullCheckout: true,
});

/** Every check in tools/review/src/checks, in file order. A new check adds itself here. */
const EXPECTED_CHECKS = [
  "architecture-names-base-folders",
  "depcruise-paths-cover-packages",
  "dockerfile-workspace-manifests",
  "env-example-parity",
  "house-rule-parity",
  "root-manifest-no-catalog",
  "shell-no-bare-array-expansion",
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "checks-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("loadChecks", () => {
  it("loads every check in the real folder, each named after its file", async () => {
    const checks = await loadChecks(checksDir(REPO_ROOT));
    expect(checks.map((c) => c.id)).toEqual(EXPECTED_CHECKS);
  });
});

describe("applyWaivers", () => {
  const finding = { file: "x.sql", line: 3, message: "bad" };

  it("drops a finding waived with a reason on the line above", () => {
    write("x.sql", "a\n-- house-check-disable-next my-check: deliberate, see ADR\nCREATE ...\n");
    expect(applyWaivers("my-check", [finding], root)).toEqual({ kept: [], waived: 1 });
  });

  it("turns a waiver with no reason into its own finding", () => {
    write("x.sql", "a\n-- house-check-disable-next my-check\nCREATE ...\n");
    const { kept, waived } = applyWaivers("my-check", [finding], root);
    expect(kept[0]?.message).toMatch(/gives no reason/);
    expect(waived).toBe(0);
  });

  it("ignores a waiver for a different check", () => {
    write("x.sql", "a\n-- house-check-disable-next other-check: reason\nCREATE ...\n");
    expect(applyWaivers("my-check", [finding], root).kept).toEqual([finding]);
  });

  it("is not fooled by a trailing comment or a JSON string", () => {
    write("x.sql", "a\nSELECT 1; -- house-check-disable-next my-check: sneaky\nCREATE ...\n");
    expect(applyWaivers("my-check", [finding], root).kept).toEqual([finding]);
    write("x.sql", 'a\n  "_n": "# house-check-disable-next my-check: sneaky",\nCREATE ...\n');
    expect(applyWaivers("my-check", [finding], root).kept).toEqual([finding]);
  });

  it("cannot waive a finding with no line", () => {
    const whole = { file: "x.sql", message: "whole-file" };
    expect(applyWaivers("my-check", [whole], root).kept).toEqual([whole]);
  });
});

describe("root-manifest-no-catalog", () => {
  it("reports a catalog: specifier with its line", async () => {
    write("package.json", '{\n  "devDependencies": {\n    "turbo": "catalog:"\n  }\n}\n');
    const [f] = await rootManifestNoCatalog.run(ctx());
    expect(f).toMatchObject({ file: "package.json", line: 3 });
  });

  it("passes a pinned range", async () => {
    write("package.json", '{ "devDependencies": { "turbo": "^2.1.0" } }');
    expect(await rootManifestNoCatalog.run(ctx())).toEqual([]);
  });
});

describe("runChecks", () => {
  it("skips devOnly checks outside a full checkout", async () => {
    const dev = {
      id: "dev",
      description: "",
      devOnly: true,
      run: () => [{ file: "f", message: "m" }],
    };
    const [result] = await runChecks([dev], { ...ctx(), fullCheckout: false });
    expect(result).toBeUndefined();
  });
});

describe("dockerfile-workspace-manifests", () => {
  const workspace = () => {
    write(
      "pnpm-workspace.yaml",
      'packages:\n  - "apps/*"\n  - "packages/*"\n\ncatalog:\n  tsx: ^4\n',
    );
    write("apps/web/package.json", "{}");
    write("packages/brand/package.json", "{}");
    write("packages/promo/package.json", "{}");
    write("packages/notes/README.md", "not a package");
  };

  it("flags a workspace package the deps stage never copies", () => {
    workspace();
    write(
      "Dockerfile",
      "FROM base AS deps\nCOPY apps/web/package.json ./apps/web/\nCOPY packages/brand/package.json ./packages/brand/\nRUN pnpm install --frozen-lockfile\n",
    );
    const findings = dockerfileWorkspaceManifests.run(ctx()) as { message: string }[];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/packages\/promo\/package\.json is not copied/);
  });

  it("passes when every package is copied, and ignores folders without a package.json", () => {
    workspace();
    write(
      "Dockerfile",
      "COPY apps/web/package.json ./apps/web/\nCOPY packages/brand/package.json ./packages/brand/\nCOPY packages/promo/package.json ./packages/promo/\nRUN pnpm install --frozen-lockfile\n",
    );
    expect(dockerfileWorkspaceManifests.run(ctx())).toEqual([]);
  });

  it("checks an app's own Dockerfile, and skips one that runs no frozen install", () => {
    workspace();
    write(
      "apps/web/Dockerfile",
      "COPY apps/web/package.json ./apps/web/\nRUN pnpm install --frozen-lockfile\n",
    );
    write("Dockerfile", "FROM nginx\n");
    const findings = dockerfileWorkspaceManifests.run(ctx()) as { file: string }[];
    expect(findings.map((f) => f.file)).toEqual(["apps/web/Dockerfile", "apps/web/Dockerfile"]);
  });

  it("accepts COPY flags such as --chown", () => {
    workspace();
    write(
      "Dockerfile",
      "COPY apps/web/package.json ./apps/web/\nCOPY --chown=node:node packages/brand/package.json ./packages/brand/\nCOPY --chown=node:node --chmod=644 packages/promo/package.json ./packages/promo/\nRUN pnpm install --frozen-lockfile\n",
    );
    expect(dockerfileWorkspaceManifests.run(ctx())).toEqual([]);
  });
});

describe("env-example-parity", () => {
  it("reports a key the app's env schema reads but .env.example does not document", async () => {
    write(
      "apps/api/src/config/env.ts",
      "export const schema = z.object({\n  DATABASE_URL: z.string(),\n  JWT_SECRET: z.string(),\n});\n",
    );
    write("apps/api/.env.example", "DATABASE_URL=postgres://x\n# optional\n");
    const findings = (await envExampleParity.run(ctx())) as { message: string }[];
    expect(findings.map((f) => f.message)).toEqual([expect.stringMatching(/^JWT_SECRET is read/)]);
  });

  it("counts a commented-out key as documented, and skips apps without a schema", async () => {
    write(
      "apps/api/src/config/env.ts",
      "const s = z.object({\n  SIMULATION_AUTO_RESET_MINUTES: z.coerce.number(),\n});\n",
    );
    write("apps/api/.env.example", "# SIMULATION_AUTO_RESET_MINUTES=15\n");
    write("apps/other/package.json", "{}");
    expect(await envExampleParity.run(ctx())).toEqual([]);
  });

  it("reports a missing .env.example", async () => {
    write("apps/api/src/config/env.ts", "const s = z.object({\n  A: z.string(),\n});\n");
    const findings = (await envExampleParity.run(ctx())) as { message: string }[];
    expect(findings[0]?.message).toBe(".env.example is missing");
  });
});

describe("shell-no-bare-array-expansion", () => {
  it("flags a bare expansion with its line, and accepts the safe form and comments", () => {
    const text = [
      "set -euo pipefail",
      'for s in "${STAGES[@]}"; do :; done',
      'turbo run x ${FILTER[@]+"${FILTER[@]}"}',
      '# the old way was "${FILTER[@]}"',
      'echo "${#ROOTS[@]}" "${ROOTS[0]}"',
      'for p in "${PIDS[@]:-}"; do :; done',
      'STAGES=("${STAGES[@]/e2e/}")',
      "run ${ARGS[@]}",
    ].join("\n");
    expect(bareExpansions(text)).toEqual([
      { line: 2, name: "STAGES" },
      { line: 6, name: "PIDS" },
      { line: 7, name: "STAGES" },
      { line: 8, name: "ARGS" },
    ]);
  });

  it("scans scripts/ and .claude/hooks/ recursively", async () => {
    write("scripts/verify/a.sh", 'x "${A[@]}"\n');
    write(".claude/hooks/b.sh", 'y ${B[@]+"${B[@]}"}\n');
    write("scripts/readme.md", '"${C[@]}"\n');
    const findings = (await shellNoBareArrayExpansion.run(ctx())) as {
      file: string;
      line?: number;
    }[];
    expect(findings.map((f) => [f.file, f.line])).toEqual([["scripts/verify/a.sh", 1]]);
  });

  it("passes the repo's own scripts", async () => {
    const real = { ...ctx(), repoRoot: REPO_ROOT };
    expect(await shellNoBareArrayExpansion.run(real)).toEqual([]);
  });
});

describe("architecture-names-base-folders", () => {
  it("reports a base folder the architecture doc does not name", async () => {
    write("packages/base/src/cases/x.ts", "");
    write("packages/base/src/features/x.ts", "");
    write("packages/base/src/index.ts", "");
    write("docs/ARCHITECTURE.md", "  cases/   capture and booking\n");
    expect(await architectureNamesBaseFolders.run(ctx())).toEqual([
      { file: "docs/ARCHITECTURE.md", message: expect.stringMatching(/features\/ is not named/) },
    ]);
  });

  it("does not count a name that only appears inside a longer one", async () => {
    write("packages/base/src/sla/x.ts", "");
    write("docs/ARCHITECTURE.md", "the slap/ folder and asla/ are other things\n");
    expect(await architectureNamesBaseFolders.run(ctx())).toHaveLength(1);
    write("docs/ARCHITECTURE.md", "`sla/` stage SLAs\n");
    expect(await architectureNamesBaseFolders.run(ctx())).toEqual([]);
  });

  it("reports a missing doc", async () => {
    write("packages/base/src/cases/x.ts", "");
    expect(await architectureNamesBaseFolders.run(ctx())).toEqual([
      { file: "docs/ARCHITECTURE.md", message: expect.stringMatching(/missing/) },
    ]);
  });

  it("passes the repo's own doc", async () => {
    const real = { ...ctx(), repoRoot: REPO_ROOT };
    expect(await architectureNamesBaseFolders.run(real)).toEqual([]);
  });
});

describe("depcruise-paths-cover-packages", () => {
  const pkg = (dir: string, name: string) => {
    write(`packages/${dir}/package.json`, JSON.stringify({ name }));
    write(`packages/${dir}/src/index.ts`, "export {};\n");
  };

  it("reports a package whose source is not mapped", async () => {
    pkg("core", "@loan/core");
    pkg("ui", "@loan/ui");
    write(
      "tsconfig.depcruise.json",
      JSON.stringify({
        "//": "x",
        compilerOptions: { paths: { "@loan/core": ["packages/core/src/index.ts"] } },
      }),
    );
    const findings = (await depcruisePathsCoverPackages.run(ctx())) as { message: string }[];
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/^@loan\/ui is not mapped/);
  });

  it("ignores packages without src/index.ts, and reports a missing config", async () => {
    write("packages/eslint-house/package.json", JSON.stringify({ name: "@loan/eslint-house" }));
    expect(await depcruisePathsCoverPackages.run(ctx())).toEqual([
      { file: "tsconfig.depcruise.json", message: expect.stringMatching(/missing/) },
    ]);
  });

  it("passes the repo's own config", async () => {
    const real = { ...ctx(), repoRoot: REPO_ROOT };
    expect(await depcruisePathsCoverPackages.run(real)).toEqual([]);
  });
});

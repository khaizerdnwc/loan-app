/**
 * Dependency rules (architecture role, deterministic). Run by `pnpm deps:check` in the
 * static stage of the gate.
 *
 * Direction: core ← contracts ← base ← apps. Lower layers never import higher ones, apps
 * never import each other, nothing imports tooling, and there are no cycles.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle makes the import order decide behaviour. Break it with a port or a shared type.",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-depends-on-nothing-internal",
      severity: "error",
      comment: "packages/core is the bottom layer: Money and shared types only.",
      from: { path: "^packages/core/src" },
      to: { path: "^(packages/(contracts|base|ui)|apps|tools)/" },
    },
    {
      name: "contracts-depend-only-on-core",
      severity: "error",
      comment:
        "Ports describe external services; they may use core types and nothing else internal.",
      from: { path: "^packages/contracts/src" },
      to: { path: "^(packages/(base|ui)|apps|tools)/" },
    },
    {
      name: "base-never-imports-apps-or-ui",
      severity: "error",
      comment:
        "Domain modules depend on ports (contracts), never on the API app or its adapters (Engineering Standard 9).",
      from: { path: "^packages/base/src" },
      to: { path: "^(apps|packages/ui|tools)/" },
    },
    {
      name: "backoffice-never-imports-server-code",
      severity: "error",
      comment: "The browser app talks to the API over HTTP; it may share types from core only.",
      from: { path: "^apps/backoffice/src" },
      to: { path: "^(apps/api|packages/(base|contracts))/" },
    },
    {
      name: "api-never-imports-backoffice",
      severity: "error",
      from: { path: "^apps/api/src" },
      to: { path: "^(apps/backoffice|packages/ui)/" },
    },
    {
      name: "product-never-imports-tooling",
      severity: "error",
      from: { path: "^(apps|packages)/[^/]+/src" },
      to: { path: "^tools/" },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules", "dist", ".next"] },
    exclude: {
      path: [
        "node_modules",
        "dist",
        "\\.next",
        "coverage",
        "\\.turbo",
        "test-results",
        "playwright-report",
      ],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};

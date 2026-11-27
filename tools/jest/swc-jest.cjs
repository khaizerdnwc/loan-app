/**
 * The one Jest transform for every package (SWC: fast, and it emits the decorator metadata
 * NestJS dependency injection needs). The server-side workspace packages (core, contracts,
 * base) are mapped to their TypeScript source, so Jest tests never depend on a stale build.
 * The web packages (ui, backoffice) test with Vitest and are not mapped here.
 */
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

/** @param {{ rootDir: string, testMatch?: string[], extra?: object }} opts */
function jestConfig({ rootDir, testMatch = ["<rootDir>/test/**/*.test.ts"], extra = {} }) {
  return {
    rootDir,
    testEnvironment: "node",
    testMatch,
    transform: {
      "^.+\\.(t|j)s$": [
        require.resolve("@swc/jest", { paths: [rootDir, root] }),
        {
          jsc: {
            parser: { syntax: "typescript", decorators: true },
            transform: { legacyDecorator: true, decoratorMetadata: true },
            target: "es2022",
          },
          module: { type: "commonjs" },
        },
      ],
    },
    moduleNameMapper: {
      "^@loan/(core|contracts|base)$": `${root}/packages/$1/src/index.ts`,
    },
    moduleFileExtensions: ["ts", "js", "json"],
    clearMocks: true,
    ...extra,
  };
}

module.exports = { jestConfig, root };

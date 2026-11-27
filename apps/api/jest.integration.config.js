const { jestConfig } = require("../../tools/jest/swc-jest.cjs");

/**
 * The integration suite: the real API against a real Postgres (TEST_DATABASE_URL, whose
 * database name must end in _test). Migrated and seeded once per run (global setup);
 * every test file starts from empty lending tables. Run with --runInBand: the files share
 * one database.
 */
module.exports = jestConfig({
  rootDir: __dirname,
  testMatch: ["<rootDir>/test/**/*.e2e-spec.ts"],
  extra: {
    globalSetup: "<rootDir>/test/support/global-setup.ts",
    setupFiles: ["<rootDir>/test/support/env.ts"],
    testTimeout: 30_000,
  },
});

const { jestConfig } = require("../../tools/jest/swc-jest.cjs");

// Unit tests only: src/**/*.spec.ts and test/**/*.test.ts. The database-backed suites
// (test/**/*.e2e-spec.ts) run with jest.integration.config.js.
module.exports = jestConfig({
  rootDir: __dirname,
  testMatch: ["<rootDir>/src/**/*.spec.ts", "<rootDir>/test/**/*.test.ts"],
});

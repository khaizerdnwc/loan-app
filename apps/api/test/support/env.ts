/**
 * The integration tests' environment, set before the app module (and its env()) loads.
 * DATABASE_URL is the throwaway test database; nothing here is a secret.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run `pnpm db:up` and use postgres://loan:loan_dev_password@127.0.0.1:5436/loan_test, or run `pnpm verify --only db,integration`.",
  );
}
const name = new URL(url).pathname.slice(1);
if (!name.endsWith("_test")) {
  throw new Error(
    `Refusing to run integration tests against "${name}": the database name must end in _test.`,
  );
}
process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-dummy-secret-at-least-32-characters-long";
process.env.SIMULATION_TIMEOUT_MS = "20";
process.env.SIMULATION_AUTO_RESET_MINUTES = "15";
process.env.MIGRATE_ON_BOOT = "false";
// The tests run the expiry sweep by hand (ExpiryService.expireStale), never on a timer.
process.env.EXPIRY_SWEEP_SECONDS = "0";
// Unset, so the app runs with the default (Swagger off), as a deployment that omits it would.
delete process.env.SWAGGER_ENABLED;

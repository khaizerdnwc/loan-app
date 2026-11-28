import { env, resetEnvForTests } from "./env";

const saved = { ...process.env };

function withEnv(values: Record<string, string | undefined>) {
  process.env = {
    DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x_test",
    JWT_SECRET: "test-dummy-secret-at-least-32-characters-long",
  };
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  resetEnvForTests();
  return env();
}

afterEach(() => {
  process.env = { ...saved };
  resetEnvForTests();
});

describe("SWAGGER_ENABLED (H-1: Swagger is an explicit opt-in)", () => {
  it.each([
    ["unset", undefined],
    ["blank", ""],
    ["false", "false"],
  ])("is off when %s, even with NODE_ENV unset (which defaults to development)", (_l, value) => {
    const e = withEnv({ SWAGGER_ENABLED: value });
    expect(e.NODE_ENV).toBe("development");
    expect(e.SWAGGER_ENABLED).toBe(false);
  });

  it('is on only when set to "true"', () => {
    expect(withEnv({ SWAGGER_ENABLED: "true" }).SWAGGER_ENABLED).toBe(true);
  });

  it("refuses any other value at boot", () => {
    expect(() => withEnv({ SWAGGER_ENABLED: "yes" })).toThrow(/SWAGGER_ENABLED/);
  });
});

import { z } from "zod";

/**
 * The API's environment, validated once at boot (house/no-process-env-outside-config: this
 * is the only file that reads process.env). A missing or malformed value stops the process
 * with a readable message instead of failing at the first request. Every key is documented
 * in apps/api/.env.example (check:env-example-parity).
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3101),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    CORS_ORIGIN: z.string().default("http://localhost:3100"),
    SIMULATION_AUTO_RESET_MINUTES: z.coerce.number().int().positive().default(15),
    SIMULATION_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    /**
     * Proxies in front of the API whose X-Forwarded-For entry is trusted for the client address
     * (throttling). 0 by default: a client-supplied header is never believed. Set it only when
     * every request reaches the API through that many proxies that append the real address.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /**
     * Serve the Swagger UI at /docs and the OpenAPI document at /docs-json. An explicit
     * opt-in, off when unset or blank: a deployment that forgets a variable publishes nothing.
     */
    SWAGGER_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    /** Run pending migrations when the API starts (deployments); off by default. */
    MIGRATE_ON_BOOT: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .refine((e) => e.NODE_ENV !== "production" || !e.JWT_SECRET.includes("dev-only"), {
    path: ["JWT_SECRET"],
    message: "JWT_SECRET is the published example value; set a real secret in production",
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * An empty variable counts as unset, so its default applies. The gate exports every key
 * empty before setting the ones it needs (scripts/verify/env.sh), and Zod's defaults only
 * apply to undefined.
 */
function withoutEmpty(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""),
  );
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(withoutEmpty(process.env));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${problems.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}

/** Forget the parsed environment (tests only). */
export function resetEnvForTests(): void {
  cached = null;
}

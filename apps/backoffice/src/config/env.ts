import { z } from "zod";

/**
 * The backoffice's server-side environment, validated on first use (the only place that
 * reads process.env — house/no-process-env-outside-config). Documented in .env.example.
 * API_URL has a local default for development only: a production server without it fails
 * at its first request instead of quietly proxying to localhost.
 */
const LOCAL_API = "http://localhost:3101";

const schema = z.object({
  NODE_ENV: z.string().optional(),
  API_URL: z.string().url().optional(),
});

export interface Env {
  API_URL: string;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid backoffice environment: ${problems.join("; ")}`);
  }
  const { NODE_ENV, API_URL } = parsed.data;
  if (!API_URL && NODE_ENV === "production") {
    throw new Error("Invalid backoffice environment: API_URL is required in production");
  }
  cached = { API_URL: API_URL ?? LOCAL_API };
  return cached;
}

/** Forget the parsed environment (tests only). */
export function resetEnvForTests(): void {
  cached = null;
}

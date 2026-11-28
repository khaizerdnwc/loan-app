import { z } from "zod";

/**
 * The backoffice's server-side environment, validated on first use (the only place that
 * reads process.env — house/no-process-env-outside-config). Documented in .env.example.
 * API_URL has a local default for development only: a production server without it fails
 * at its first request instead of quietly proxying to localhost.
 */
const LOCAL_API = "http://localhost:3101";

// Server only (what the `server-only` package would enforce): a module that ends up in a
// client bundle fails as soon as it loads in the browser, instead of shipping server
// configuration to it. house/no-server-env-in-client stops the import at lint time.
if (typeof window !== "undefined") {
  throw new Error("config/env is server-only: it was loaded in the browser.");
}

const schema = z.object({
  NODE_ENV: z.string().optional(),
  API_URL: z.string().url().optional(),
  /**
   * Load balancers in front of the backoffice that append the client's address to
   * X-Forwarded-For. 0 (default): no address is passed to the API. n: the n-th entry from the
   * right is the client's (everything left of it is client-chosen) and is passed on alone.
   * Named apart from the API's TRUST_PROXY_HOPS (which counts the backoffice itself), so one
   * shell running both apps under `pnpm dev` cannot set the two by accident.
   */
  WEB_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
});

export interface Env {
  API_URL: string;
  WEB_TRUST_PROXY_HOPS: number;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    API_URL: process.env.API_URL || undefined,
    WEB_TRUST_PROXY_HOPS: process.env.WEB_TRUST_PROXY_HOPS || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid backoffice environment: ${problems.join("; ")}`);
  }
  const { NODE_ENV, API_URL, WEB_TRUST_PROXY_HOPS } = parsed.data;
  if (!API_URL && NODE_ENV === "production") {
    throw new Error("Invalid backoffice environment: API_URL is required in production");
  }
  if (NODE_ENV === "production" && WEB_TRUST_PROXY_HOPS > 0) {
    // Over-counting hands the client its own rate-limit bucket: say what is being trusted.
    console.warn(
      `WEB_TRUST_PROXY_HOPS=${WEB_TRUST_PROXY_HOPS}: the backoffice believes that many load ` +
        "balancers in front of it append the client address to X-Forwarded-For. If fewer do, " +
        "clients can choose their own rate-limit bucket. Check it with a forged " +
        "X-Forwarded-For through the public URL (docs/DEPLOY.md, checks after deploying).",
    );
  }
  cached = { API_URL: API_URL ?? LOCAL_API, WEB_TRUST_PROXY_HOPS };
  return cached;
}

/** Forget the parsed environment (tests only). */
export function resetEnvForTests(): void {
  cached = null;
}

// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_ROOTS, GET } from "@/app/api/[...path]/route";
import { resetEnvForTests } from "@/config/env";

/**
 * Every API root the backoffice calls must be forwarded by its /api proxy. The proxy keeps an
 * allow-list of roots; a screen calling a root the list lacks gets the proxy's own 404, which
 * the screen then reads as "not found" (the walk-in lookup said core had no such customer).
 * Unit tests mock `api()`, so only this guard sees the gap: it collects the first path segment
 * of every `api(...)` / `useApi(...)` call and every action `path:` in apps/backoffice/src,
 * and asks the proxy to forward each.
 */
const SRC = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** `api<T>("/cases…`, `useApi<T>(\`/customers/${…}`, `path: (id) => \`/cases/${id}/pick\``. */
const CALL = /\b(?:api|useApi)[^(\s]{0,60}\(\s?[`"']\/([a-z][a-z-]*)/g;
const ACTION_PATH = /\bpath:\s*\([^)]*\)\s*=>\s*`\/([a-z][a-z-]*)/g;
/** A path built before the call, e.g. `return \`/products/PL/quote?…\`` in a hook. */
const BUILT_PATH = /\breturn\s*`\/([a-z][a-z-]*)\//g;
/** A path handed to a component that fetches it, e.g. `<ReportPage path="/reports/funnel" />`. */
const PATH_PROP = /\bpath=["{`']+\/([a-z][a-z-]*)\//g;

function rootsCalled(): Map<string, string> {
  const roots = new Map<string, string>();
  for (const file of files(SRC)) {
    if (file.includes(`${join("app", "api")}`)) continue;
    const text = readFileSync(file, "utf8");
    for (const re of [CALL, ACTION_PATH, BUILT_PATH, PATH_PROP]) {
      for (const m of text.matchAll(re)) {
        const root = m[1] as string;
        if (!roots.has(root)) roots.set(root, relative(SRC, file));
      }
    }
  }
  return roots;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test:9000");
  resetEnvForTests();
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvForTests();
});

describe("the /api proxy forwards every API root the backoffice calls", () => {
  const roots = rootsCalled();

  it("finds the roots the screens call (the scan itself works)", () => {
    for (const root of [
      "cases",
      "applicants",
      "customers",
      "loan-officers",
      "products",
      "reports",
    ]) {
      expect(roots.has(root)).toBe(true);
    }
  });

  it.each([...roots.entries()])("forwards /api/%s… (called from %s)", async (root) => {
    const request = new NextRequest(`http://office.test/api/${root}/x`, { method: "GET" });
    const res = await GET(request, { params: Promise.resolve({ path: [root, "x"] }) });
    expect(res.status).not.toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The sturdier half: the allow-list against the routes the API actually serves, so a root is
 * caught even when the backoffice builds its path in a way the scan above cannot see. Read
 * from the Nest controllers: each `@Controller("prefix")`, and for a bare `@Controller()` the
 * first segment of each handler's route.
 */
const REPO = join(__dirname, "..", "..", "..");
const SERVER_SOURCES = [join(REPO, "packages", "base", "src"), join(REPO, "apps", "api", "src")];
const PREFIX = /@Controller\(\s?["'`]([^"'`]+)["'`]\s?\)/g;
const BARE = /@Controller\(\s?\)/;
const HANDLER = /@(?:Get|Post|Put|Patch|Delete)\(\s?["'`]([^"'`]+)["'`]/g;

/**
 * Served on purpose but never through the proxy:
 * - health: the platform's liveness probe calls the API directly; the backoffice has no use
 *   for it, and keeping it out of the proxy keeps the browser-facing surface minimal.
 * - metrics: Prometheus scrapes the API on its private network (and it is off unless
 *   METRICS_ENABLED=true); through the proxy it would publish request counts and provider
 *   health to anyone with a browser.
 */
const NOT_PROXIED = new Set(["health", "metrics"]);

function rootsServed(): Map<string, string> {
  const roots = new Map<string, string>();
  const add = (path: string, file: string) => {
    const root = path.replace(/^\//, "").split("/")[0] ?? "";
    if (root && !roots.has(root)) roots.set(root, relative(REPO, file));
  };
  for (const file of SERVER_SOURCES.flatMap(files)) {
    // Controllers live in *.controller.ts, and one (health) in the API's app.module.ts.
    const text = readFileSync(file, "utf8");
    if (!text.includes("@Controller(")) continue;
    for (const m of text.matchAll(PREFIX)) add(m[1] as string, file);
    if (BARE.test(text)) for (const m of text.matchAll(HANDLER)) add(m[1] as string, file);
  }
  return roots;
}

describe("the /api proxy's allow-list matches the API's routes", () => {
  const served = rootsServed();

  it("finds the API's controllers (the scan itself works)", () => {
    for (const root of ["auth", "cases", "customers", "reports", "health", "simulation"]) {
      expect(served.has(root)).toBe(true);
    }
  });

  it("allow-lists every root the API serves, except the deliberate exclusions", () => {
    const missing = [...served.keys()].filter((r) => !NOT_PROXIED.has(r) && !ALLOWED_ROOTS.has(r));
    expect(missing).toEqual([]);
  });

  it("allow-lists nothing the API does not serve, and none of the exclusions", () => {
    const stale = [...ALLOWED_ROOTS].filter((r) => !served.has(r) || NOT_PROXIED.has(r));
    expect(stale).toEqual([]);
  });
});

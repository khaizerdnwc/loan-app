import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/config/env";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

/** The API's top-level routes the backoffice may reach; anything else is not forwarded. */
const ALLOWED_ROOTS = new Set([
  "auth",
  "cases",
  "applicants",
  "products",
  "decisions",
  "simulation",
]);

/** How long the API may take before the browser is told it is not answering. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

const SESSION_COOKIE = "session";

/**
 * Forwards /api/* to the API (docs/API.md), so the browser only ever talks to this origin
 * and the httpOnly session cookie stays first-party. Only the session cookie and the
 * headers the API needs go through; the API's Set-Cookie comes back unchanged.
 */
async function forward(request: NextRequest, { params }: Context): Promise<Response> {
  const { path } = await params;
  if (path.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return problem(400, "Bad path", "That address is not part of the API.");
  }
  if (!ALLOWED_ROOTS.has(path[0] ?? "")) {
    return problem(404, "Not found", "That address is not part of the API.");
  }
  const target = new URL(
    `/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
    env().API_URL,
  );

  const headers = new Headers({ accept: "application/json" });
  for (const name of ["content-type", "authorization"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (session) headers.set("cookie", `${SESSION_COOKIE}=${session}`);
  const hasBody = !["GET", "HEAD"].includes(request.method);

  // Reading the body is inside the try too: a body that stalls past the timeout is a 502,
  // not a hung request. A client's x-forwarded-for is never passed on (it is client-chosen).
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const out = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) out.set("content-type", contentType);
    for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
    const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
    return new NextResponse(body, { status: upstream.status, headers: out });
  } catch {
    return problem(
      502,
      "API unavailable",
      "The lending service is not answering. Try again in a moment.",
    );
  }
}

function problem(status: number, title: string, detail: string): Response {
  const code =
    status === 502 ? "PROVIDER_UNAVAILABLE" : status === 404 ? "NOT_FOUND" : "VALIDATION_FAILED";
  return NextResponse.json(
    { type: "about:blank", title, status, detail, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;

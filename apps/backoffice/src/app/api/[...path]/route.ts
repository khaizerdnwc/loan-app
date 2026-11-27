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
  "compliance",
  "audit",
  "automation",
  "operations",
  "reports",
  "providers",
]);

/** How long the API may take before the browser is told it is not answering. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

/**
 * The largest request body forwarded: the API's own JSON body limit (Express's 100 kB
 * default), so an oversized body is refused here instead of being buffered and sent on.
 */
export const MAX_REQUEST_BODY_BYTES = 100 * 1024;

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

  // One deadline covers the whole exchange: reading the client's body, then the API's answer.
  // A client body that stalls past it is a 504; an API that does not answer in time is a 502.
  // A client's x-forwarded-for is never passed on (it is client-chosen).
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("timed out", "TimeoutError")),
    UPSTREAM_TIMEOUT_MS,
  );
  try {
    let requestBody: string | undefined;
    try {
      const read = hasBody
        ? await readCapped(request, MAX_REQUEST_BODY_BYTES, deadline.signal)
        : undefined;
      if (read === TOO_LARGE) {
        return problem(413, "Request too large", "That request is larger than the API accepts.");
      }
      requestBody = read;
    } catch {
      return problem(504, "Request timed out", "The request did not arrive in time. Try again.");
    }
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: requestBody,
      redirect: "manual",
      cache: "no-store",
      signal: deadline.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

const TOO_LARGE = Symbol("too large");

/**
 * The request body as text, or TOO_LARGE once it passes `limit` bytes. A declared
 * Content-Length over the limit is refused before reading; a chunked or understated body is
 * counted as it streams in and dropped at the limit, so it is never buffered whole. Each read
 * races `signal`: when it aborts, the reader is cancelled and the read rejects.
 */
async function readCapped(
  request: NextRequest,
  limit: number,
  signal: AbortSignal,
): Promise<string | typeof TOO_LARGE> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared > limit) return TOO_LARGE;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => undefined); // observed below; never an unhandled rejection
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        return TOO_LARGE;
      }
      chunks.push(value);
    }
  } catch (err) {
    void reader.cancel().catch(() => undefined);
    throw err;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function problem(status: number, title: string, detail: string): Response {
  const code =
    status >= 500 ? "PROVIDER_UNAVAILABLE" : status === 404 ? "NOT_FOUND" : "VALIDATION_FAILED";
  return NextResponse.json(
    { type: "about:blank", title, status, detail, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;

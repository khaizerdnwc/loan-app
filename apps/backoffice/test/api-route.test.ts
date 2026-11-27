// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, MAX_REQUEST_BODY_BYTES, POST, UPSTREAM_TIMEOUT_MS } from "@/app/api/[...path]/route";
import { resetEnvForTests } from "@/config/env";

const API = "http://api.test:9000";

function call(
  handler: typeof GET,
  path: string[],
  init: { url?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const request = new NextRequest(init.url ?? `http://office.test/api/${path.join("/")}`, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
  return handler(request, { params: Promise.resolve({ path }) });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("API_URL", API);
  resetEnvForTests();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetEnvForTests();
});

function sent(): { url: string; init: RequestInit & { headers: Headers } } {
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { headers: Headers }];
  return { url: url.toString(), init };
}

describe("the /api/* proxy", () => {
  it.each([["."], [".."], [""]])(
    "refuses a %j path segment without calling the API",
    async (bad) => {
      const res = await call(GET, ["cases", bad, "x"]);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a top-level route that is not allow-listed (e.g. /docs)", async () => {
    const res = await call(GET, ["docs"]);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the automation controls (AU-1)", async () => {
    await call(GET, ["automation", "PL", "history"]);
    expect(sent().url).toBe(`${API}/automation/PL/history`);
  });

  it.each([
    ["compliance", "escalations"],
    ["audit", "events"],
  ])("forwards the compliance screens' routes (/%s/%s)", async (root, rest) => {
    await call(GET, [root, rest], { url: `http://office.test/api/${root}/${rest}?view=all` });
    expect(sent().url).toBe(`${API}/${root}/${rest}?view=all`);
  });

  it("keeps an encoded slash inside one segment and passes the query string through", async () => {
    await call(GET, ["cases", "a/b"], { url: "http://office.test/api/cases/a%2Fb?view=all" });
    expect(sent().url).toBe(`${API}/cases/a%2Fb?view=all`);
  });

  it("forwards only the session cookie, content type and authorization, never a client-supplied x-forwarded-for", async () => {
    await call(GET, ["cases"], {
      headers: {
        cookie: "session=abc; other=leak",
        "x-evil": "1",
        authorization: "Bearer t",
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      },
    });
    const h = sent().init.headers;
    expect(h.get("cookie")).toBe("session=abc");
    expect(h.get("authorization")).toBe("Bearer t");
    expect(h.get("x-forwarded-for")).toBeNull();
    expect(h.get("x-evil")).toBeNull();
    expect(sent().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards a POST body", async () => {
    await call(POST, ["cases"], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"amount":"150000.00"}',
    });
    expect(sent().init).toMatchObject({ method: "POST", body: '{"amount":"150000.00"}' });
    expect(sent().init.headers.get("content-type")).toBe("application/json");
  });

  it("forwards a body of exactly the cap", async () => {
    const body = "x".repeat(MAX_REQUEST_BODY_BYTES);
    const res = await call(POST, ["cases"], { method: "POST", body });
    expect(res.status).toBe(200);
    expect(sent().init.body).toBe(body);
  });

  it("refuses a body over the cap with 413, without calling the API", async () => {
    const res = await call(POST, ["cases"], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ status: 413, code: "VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a declared Content-Length over the cap before reading the body", async () => {
    const res = await call(POST, ["cases"], {
      method: "POST",
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
      body: "{}",
    });
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric Content-Length with 413, without calling the API", async () => {
    const res = await call(POST, ["cases"], {
      method: "POST",
      headers: { "content-length": "abc" },
      body: "{}",
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ status: 413, code: "VALIDATION_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 504 when the client's body stalls past the deadline, and cancels the read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let cancelled = false;
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"amount":'));
        },
        pull: () => new Promise<void>(() => undefined), // never sends the rest
        cancel() {
          cancelled = true;
        },
      });
      const request = new NextRequest("http://office.test/api/cases", {
        method: "POST",
        body: stalled,
        duplex: "half",
        // Node's fetch needs duplex for a stream body; Next's RequestInit type does not list it.
      } as unknown as ConstructorParameters<typeof NextRequest>[1]);
      let settled = false;
      const pending = POST(request, { params: Promise.resolve({ path: ["cases"] }) }).finally(
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.status).toBe(504);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(await res.json()).toMatchObject({ status: 504, code: "PROVIDER_UNAVAILABLE" });
      expect(cancelled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a streamed body with no Content-Length and stops at the cap", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024);
    const chunks = MAX_REQUEST_BODY_BYTES / chunk.byteLength + 20; // well past the cap
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > chunks) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new NextRequest("http://office.test/api/cases", {
      method: "POST",
      body: stream,
      duplex: "half",
      // Node's fetch needs duplex for a stream body; Next's RequestInit type does not list it.
    } as unknown as ConstructorParameters<typeof NextRequest>[1]);
    const res = await POST(request, { params: Promise.resolve({ path: ["cases"] }) });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(MAX_REQUEST_BODY_BYTES / chunk.byteLength + 4);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes every Set-Cookie back and drops other upstream headers", async () => {
    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      "x-powered-by": "x",
    });
    upstreamHeaders.append("set-cookie", "session=new; HttpOnly");
    upstreamHeaders.append("set-cookie", "other=2");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200, headers: upstreamHeaders }));
    const res = await call(POST, ["auth", "sign-in"], { method: "POST", body: "{}" });
    expect(res.headers.getSetCookie()).toEqual(["session=new; HttpOnly", "other=2"]);
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("answers 204 with no body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await call(POST, ["auth", "logout"], { method: "POST" });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("turns an unreachable or timed-out API into a 502 problem body", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const res = await call(GET, ["cases"]);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 502 });
  });

  it("turns a response body that stalls past the timeout into a 502 problem body", async () => {
    const stalled = new ReadableStream({
      start(controller) {
        controller.error(new DOMException("timed out", "TimeoutError"));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stalled, { status: 200 }));
    const res = await call(GET, ["cases"]);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("passes the API's own error status and body through", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"status":403,"detail":"No."}', {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      }),
    );
    const res = await call(GET, ["cases"]);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ detail: "No." });
  });
});

describe("backoffice environment", () => {
  it("requires API_URL in production", () => {
    vi.stubEnv("API_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    resetEnvForTests();
    return expect(call(GET, ["cases"])).rejects.toThrow(/API_URL is required/);
  });
});

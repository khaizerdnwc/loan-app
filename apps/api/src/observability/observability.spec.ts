import type { ProviderGateway } from "@loan/base";
import { NotFoundException } from "@nestjs/common";
import { HttpMetrics, labels } from "./http-metrics";
import { MetricsController } from "./metrics.controller";
import { requestIdFrom, routePattern } from "./request-log";

describe("HttpMetrics (Prometheus text)", () => {
  it("counts requests by method, route pattern and status", () => {
    const m = new HttpMetrics();
    m.record("GET", "/cases/:id", 200, 0.02);
    m.record("GET", "/cases/:id", 200, 0.03);
    m.record("GET", "/cases/:id", 404, 0.001);
    const text = m.render();
    expect(text).toContain('http_requests_total{method="GET",route="/cases/:id",status="200"} 2');
    expect(text).toContain('http_requests_total{method="GET",route="/cases/:id",status="404"} 1');
  });

  it("keeps cumulative duration buckets, a +Inf bucket, the sum and the count", () => {
    const m = new HttpMetrics();
    m.record("POST", "/cases", 201, 0.02); // ≤ 0.025
    m.record("POST", "/cases", 201, 0.3); // ≤ 0.5
    m.record("POST", "/cases", 201, 20); // above every bucket
    const text = m.render();
    const bucket = (le: string) =>
      new RegExp(
        `http_request_duration_seconds_bucket\\{method="POST",route="/cases",le="${le.replace("+", "\\+")}"\\} (\\d+)`,
      ).exec(text)?.[1];
    expect(bucket("0.01")).toBe("0");
    expect(bucket("0.025")).toBe("1");
    expect(bucket("0.5")).toBe("2");
    expect(bucket("10")).toBe("2");
    expect(bucket("+Inf")).toBe("3");
    expect(text).toContain('http_request_duration_seconds_count{method="POST",route="/cases"} 3');
    expect(text).toMatch(
      /http_request_duration_seconds_sum\{method="POST",route="\/cases"\} 20\.32/,
    );
    expect(text).toContain("# TYPE http_request_duration_seconds histogram");
  });

  it("escapes label values as the exposition format requires", () => {
    expect(labels({ a: 'x"y\\z\nw' })).toBe('{a="x\\"y\\\\z\\nw"}');
  });
});

describe("request log helpers", () => {
  it("keeps a well-formed caller request id and replaces anything else", () => {
    expect(requestIdFrom("browser-req-42")).toBe("browser-req-42");
    for (const bad of [undefined, "short", "has space here", "a".repeat(65), "line\nbreak-id"]) {
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(requestIdFrom(["browser-req-43", "other-1234"])).toBe("browser-req-43");
  });

  it("names the matched route pattern, never the path", () => {
    expect(routePattern({ method: "GET", headers: {}, route: { path: "/cases/:id" } })).toBe(
      "/cases/:id",
    );
    expect(
      routePattern({ method: "GET", headers: {}, baseUrl: "/v1", route: { path: "/x" } }),
    ).toBe("/v1/x");
    expect(routePattern({ method: "GET", headers: {} })).toBe("unmatched");
  });
});

describe("MetricsController", () => {
  const usage = jest.fn(async () => ({
    since: "2026-11-28T00:00:00.000Z",
    totalCost: "0.00",
    services: [
      {
        service: "CREDIT_BUREAU",
        attempts: 3,
        ok: 2,
        failed: 1,
        shortCircuited: 0,
        cacheHits: 4,
        cost: "0.00",
        circuit: { state: "OPEN", consecutiveFailures: 5, openUntil: null },
      },
    ],
  }));
  const providers = { usage } as unknown as ProviderGateway;
  beforeEach(() => usage.mockClear());

  it("switched off: answers NotFound and never reads provider usage", async () => {
    const controller = new MetricsController(new HttpMetrics(), providers, false);
    await expect(controller.metrics()).rejects.toBeInstanceOf(NotFoundException);
    expect(usage).not.toHaveBeenCalled();
  });

  it("switched on: provider attempts by outcome and the circuit state", async () => {
    const controller = new MetricsController(new HttpMetrics(), providers, true);
    const text = await controller.metrics();
    expect(usage).toHaveBeenCalledTimes(1);
    expect(text).toContain('loan_provider_attempts{service="CREDIT_BUREAU",outcome="ok"} 2');
    expect(text).toContain('loan_provider_attempts{service="CREDIT_BUREAU",outcome="failed"} 1');
    expect(text).toContain('loan_provider_attempts{service="CREDIT_BUREAU",outcome="cache_hit"} 4');
    expect(text).toContain('loan_provider_circuit_open{service="CREDIT_BUREAU"} 1');
  });
});

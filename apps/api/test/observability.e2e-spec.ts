import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../src/app";
import { AppModule } from "../src/app.module";
import { METRICS_ENABLED } from "../src/observability/http-metrics";
import { stdoutWriter } from "../src/observability/request-log";
import { type Harness, STAFF, startHarness, submitCase } from "./support/harness";

/**
 * #34 first slice (PRD NFR-012): one structured log line per request, a request id echoed back,
 * and GET /metrics in the Prometheus text format, off unless METRICS_ENABLED=true.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

type LogLine = Record<string, unknown>;

/**
 * The request log lines written to stdout while `fn` runs. The line is written on the
 * response's `finish`, which can land just after the client has the response, so this waits
 * (up to 2 s) until `until` holds before it stops listening; the assertions then run on
 * everything captured.
 */
async function captureLogs(
  fn: () => Promise<unknown>,
  until: (logs: LogLine[]) => boolean,
): Promise<LogLine[]> {
  const logs: LogLine[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (text.startsWith('{"msg":"request"')) {
        logs.push(JSON.parse(text) as LogLine);
        return true;
      }
      return (original as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
    });
  try {
    await fn();
    const deadline = Date.now() + 2000;
    while (!until(logs) && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    spy.mockRestore();
  }
  return logs;
}

const byId = (id: string) => (logs: LogLine[]) => logs.some((l) => l.requestId === id);

describe("request logs (NFR-012)", () => {
  it("one JSON line per request: id, method, route pattern, status, duration, staff id, and nothing a caller sent", async () => {
    const c = await submitCase(h, { applicantId: "APL-MARIA" });
    let echoed = "";
    const logs = await captureLogs(async () => {
      const res = await h
        .as("paolo")
        .get(`/cases/${c.id}?view=all&secret=s3cr3t-query`)
        .set("x-request-id", "browser-req-0001")
        .expect(200);
      echoed = String(res.headers["x-request-id"]);
    }, byId("browser-req-0001"));
    expect(echoed).toBe("browser-req-0001");
    const line = logs.find((l) => l.requestId === "browser-req-0001");
    expect(line).toEqual({
      msg: "request",
      requestId: "browser-req-0001",
      method: "GET",
      route: "/cases/:id",
      status: 200,
      durationMs: expect.any(Number),
      staffId: STAFF.paolo,
    });
    // Nothing from the path, the query, the cookie or the applicant reaches the log.
    const raw = JSON.stringify(logs);
    for (const leaked of [c.id, "s3cr3t-query", "view=all", "session=", "APL-MARIA", c.reference]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it("a body (with applicant data) is never logged; a bad request id is replaced", async () => {
    let echoed = "";
    const logs = await captureLogs(
      async () => {
        const res = await h
          .as("paolo")
          .post("/applicants", {
            fullName: "Log Leak Probe",
            birthDate: "1990-01-01",
            governmentIdLast4: "9876",
            employer: "Probe Trading",
            employmentMonths: 24,
            monthlyIncome: "41000.00",
            monthlyObligations: "1000.00",
          })
          .set("x-request-id", "bad id with spaces")
          .expect(201);
        echoed = String(res.headers["x-request-id"]);
      },
      (logs) => echoed !== "" && byId(echoed)(logs),
    );
    expect(echoed).toMatch(/^[0-9a-f-]{36}$/);
    const line = logs.find((l) => l.requestId === echoed);
    expect(line).toMatchObject({ route: "/applicants", status: 201, staffId: STAFF.paolo });
    const raw = JSON.stringify(logs);
    for (const leaked of ["Log Leak Probe", "9876", "Probe Trading", "41000", "bad id"]) {
      expect(raw).not.toContain(leaked);
    }
  });

  it("an anonymous or unmatched request logs no staff id and no path", async () => {
    const logs = await captureLogs(async () => {
      await request(h.app.getHttpServer())
        .get("/no-such-root/APL-MARIA")
        .set("x-request-id", "unmatched-req-1")
        .expect(404);
    }, byId("unmatched-req-1"));
    const line = logs.find((l) => l.requestId === "unmatched-req-1");
    expect(line).toMatchObject({ route: "unmatched", status: 404, staffId: null });
    expect(JSON.stringify(logs)).not.toContain("APL-MARIA");
  });

  it("the /health probe is not logged (it is still counted in the metrics)", async () => {
    const logs = await captureLogs(async () => {
      await request(h.app.getHttpServer())
        .get("/health")
        .set("x-request-id", "health-req-01")
        .expect(200);
      // A logged request after it: once its line is in, the probe's would be too.
      await request(h.app.getHttpServer())
        .get("/no-such-root")
        .set("x-request-id", "after-health-1")
        .expect(404);
    }, byId("after-health-1"));
    expect(byId("after-health-1")(logs)).toBe(true);
    expect(byId("health-req-01")(logs)).toBe(false);
  });

  it("each line is bare JSON on stdout, one per line", async () => {
    const chunks: string[] = [];
    const spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      stdoutWriter({
        msg: "request",
        requestId: "format-req-01",
        method: "GET",
        route: "/cases",
        status: 200,
        durationMs: 3,
        staffId: null,
      });
    } finally {
      spy.mockRestore();
    }
    expect(chunks).toEqual([
      '{"msg":"request","requestId":"format-req-01","method":"GET","route":"/cases","status":200,"durationMs":3,"staffId":null}\n',
    ]);
  });
});

describe("GET /metrics (NFR-012)", () => {
  it("is off by default: 404 like any unknown route", async () => {
    const res = await request(h.app.getHttpServer()).get("/metrics").expect(404);
    expect(res.text).not.toContain("http_requests_total");
  });

  it("when switched on, serves request and provider metrics by route pattern, with no ids", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(METRICS_ENABLED)
      .useValue(true)
      .compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    try {
      const server = app.getHttpServer();
      const missing = "00000000-0000-4000-8000-000000000001";
      await request(server).get("/health").expect(200);
      await request(server).get(`/cases/${missing}`).expect(401);
      const res = await request(server).get("/metrics").expect(200);
      expect(res.headers["content-type"]).toMatch(/^text\/plain;/);
      expect(res.headers["content-type"]).toContain("version=0.0.4");
      expect(res.text).toContain(
        'http_requests_total{method="GET",route="/health",status="200"} 1',
      );
      expect(res.text).toContain(
        'http_requests_total{method="GET",route="/cases/:id",status="401"} 1',
      );
      expect(res.text).toContain("# TYPE http_request_duration_seconds histogram");
      expect(res.text).toMatch(
        /loan_provider_attempts\{service="CREDIT_BUREAU",outcome="ok"\} \d+/,
      );
      expect(res.text).toMatch(/loan_provider_circuit_open\{service="CREDIT_BUREAU"\} 0/);
      expect(res.text).not.toContain(missing);
    } finally {
      await app.close();
    }
  });
});

import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

/**
 * OB-3: scripts/load/applications.mjs, run against a stand-in API on localhost (no database):
 * the report's counts, statuses, error rate and exit code, and the refusals that stop it before
 * any request is sent.
 */
const SCRIPT = resolve(__dirname, "../../../scripts/load/applications.mjs");

interface Fake {
  server: Server;
  url: string;
  hits: string[];
}

/** A stand-in for the API's sign-in, walk-in capture, case submit and reads. */
async function fakeApi(submitStatus: number, throttleFirstRead = false): Promise<Fake> {
  const hits: string[] = [];
  let n = 0;
  let throttle = throttleFirstRead;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on("end", () => {
      const route = `${req.method} ${(req.url ?? "").split("?")[0]?.replace(/\/(?=[0-9a-z-]*\d)[0-9a-z-]{8,}$/, "/:id")}`; // ids carry a digit
      hits.push(route);
      const json = (status: number, body: object, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(body));
      };
      if (route === "POST /auth/sign-in") {
        json(200, { id: "STF-PAOLO" }, { "set-cookie": "session=fake-session; HttpOnly" });
      } else if (route === "POST /applicants") {
        json(201, { id: `APL-LOAD-${String(++n).padStart(8, "0")}` });
      } else if (route === "POST /cases") {
        json(
          submitStatus,
          submitStatus === 201 ? { id: `case-${String(n).padStart(8, "0")}` } : {},
        );
      } else if (route === "GET /cases/:id" && throttle) {
        throttle = false;
        json(429, { code: "RATE_LIMITED" });
      } else if (route.startsWith("GET /cases")) {
        json(200, {});
      } else {
        json(404, {});
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, hits };
}

function run(
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    children.add(child);
    // A hung script is killed rather than left running after the test.
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      done({ code, stdout, stderr });
    });
  });
}

const children = new Set<ChildProcess>();
let fake: Fake | undefined;
afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  if (fake) await new Promise((r) => fake?.server.close(r));
  fake = undefined;
});

describe("the load script (OB-3)", () => {
  it("reports every operation, the completed applications and a zero error rate, and exits 0", async () => {
    fake = await fakeApi(201);
    const r = await run({
      BASE_URL: fake.url,
      APPLICATIONS: "4",
      CONCURRENCY: "2",
      RATE_PER_MINUTE: "0",
    });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({
      applicationsCompleted: 4,
      requests: 16,
      errorRate: 0,
      throttled429: 0,
      settings: { applications: 4, concurrency: 2, ratePerMinute: 0 },
    });
    for (const op of [
      "POST /applicants",
      "POST /cases (submit)",
      "GET /cases/:id",
      "GET /cases (queue)",
    ]) {
      const o = report.operations[op];
      expect(o.count).toBe(4);
      expect(o.statuses).toEqual({ [op.startsWith("POST") ? "201" : "200"]: 4 });
      expect(o.p50Ms).toBeLessThanOrEqual(o.p95Ms);
      expect(o.p95Ms).toBeLessThanOrEqual(o.p99Ms);
      expect(o.p99Ms).toBeLessThanOrEqual(o.maxMs);
    }
    // Throughput and the NFR-004 multiple are derived from each other (6.94 a minute = 10,000 a day).
    expect(report.applicationsPerMinute).toBeGreaterThan(0);
    expect(report.nfr004.averageMultipleAchieved).toBeCloseTo(
      report.applicationsPerMinute / 6.94,
      0,
    );
    expect(fake.hits.filter((h) => h === "POST /auth/sign-in")).toHaveLength(1);
  });

  it("counts a 429 in throttled429 and in the error rate", async () => {
    fake = await fakeApi(201, true);
    const r = await run({
      BASE_URL: fake.url,
      APPLICATIONS: "4",
      CONCURRENCY: "1",
      RATE_PER_MINUTE: "0",
      MAX_ERROR_RATE: "1",
    });
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({ requests: 16, throttled429: 1, errorRate: 0.0625 });
    expect(report.operations["GET /cases/:id"].statuses).toEqual({ "200": 3, "429": 1 });
  });

  it("counts failed submits in the error rate and exits 1 above MAX_ERROR_RATE", async () => {
    fake = await fakeApi(500);
    const r = await run({
      BASE_URL: fake.url,
      APPLICATIONS: "3",
      CONCURRENCY: "1",
      RATE_PER_MINUTE: "0",
    });
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    // Three captures succeed, three submits fail, nothing after a failed submit is sent.
    expect(report).toMatchObject({ applicationsCompleted: 0, requests: 6, errorRate: 0.5 });
    expect(report.operations["POST /cases (submit)"].statuses).toEqual({ "500": 3 });
    expect(r.stderr).toContain("above MAX_ERROR_RATE");
  });

  it.each([
    ["APPLICATIONS", "abc"],
    ["APPLICATIONS", "0"],
    ["CONCURRENCY", "2.5"],
    ["RATE_PER_MINUTE", "-1"],
    ["MAX_ERROR_RATE", "2"],
  ])("refuses %s=%s with exit 2 before sending anything", async (name, value) => {
    fake = await fakeApi(201);
    const r = await run({ BASE_URL: fake.url, [name]: value });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(name);
    expect(fake.hits).toEqual([]);
  });

  it("refuses a host that is not local unless LOAD_CONFIRM names it, before any request", async () => {
    const r = await run({ BASE_URL: "https://lending.example.invalid/api" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("LOAD_CONFIRM=lending.example.invalid");
    const wrong = await run({
      BASE_URL: "https://lending.example.invalid/api",
      LOAD_CONFIRM: "other.example.invalid",
    });
    expect(wrong.code).toBe(2);
  });

  it.each([
    // "localhost" as the user name; the host is lending.example.invalid.
    ["http://localhost@lending.example.invalid/api", "lending.example.invalid"],
    // A domain that merely starts with "localhost".
    ["http://localhost.lending.example.invalid/api", "localhost.lending.example.invalid"],
  ])("is not fooled by %s (exit 2, nothing sent)", async (url, host) => {
    fake = await fakeApi(201);
    const r = await run({ BASE_URL: url });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`LOAD_CONFIRM=${host}`);
    expect(fake.hits).toEqual([]);
  });
});

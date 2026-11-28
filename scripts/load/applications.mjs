#!/usr/bin/env node
// Load test for PRD NFR-004 (10,000 applications a day; 500 staff) and a first latency read
// (NFR-002's 500 ms p95 is for the borrower API, which does not exist; staff routes are
// measured instead). Plain Node 22, no dependencies. Synthetic data only: each application
// captures a new synthetic walk-in, then submits a case for it (one open application per
// applicant), then reads it back and lists the officer's queue.
//
//   BASE_URL=http://localhost:3101 node scripts/load/applications.mjs
//   BASE_URL=https://<backoffice>/api APPLICATIONS=300 RATE_PER_MINUTE=120 node scripts/load/applications.mjs
//
// Settings (environment):
//   BASE_URL          API root, or the backoffice's /api proxy   (default http://localhost:3101)
//   LOAD_USERNAME/LOAD_PASSWORD  a loan officer test account   (default paolo / the published test password)
//   APPLICATIONS      applications to submit                     (default 100)
//   CONCURRENCY       applications in flight at once             (default 5)
//   RATE_PER_MINUTE   application starts per minute, 0 = no cap  (default 120: ~17× the
//                     average of 10,000 a day, and under the API's 300-a-minute-per-user limit)
//   MAX_ERROR_RATE    fail (exit 1) above this share of failed requests (default 0.01)
//   LOAD_CONFIRM      required for any host other than localhost: the BASE_URL's host, exactly
//                     (each application writes rows that cannot be deleted; docs/DEPLOY.md)
//
// Prints one JSON report (the format is in docs/DEPLOY.md "Load test"): per operation the count,
// p50/p95/p99/max in ms and the statuses seen; overall the applications completed, the error
// rate, 429s, and applications per minute achieved. 429s count as errors: one user is limited
// to 300 requests a minute per route, so a higher RATE_PER_MINUTE measures the limiter.
// Exit codes: 0 done, 1 error rate above MAX_ERROR_RATE (or sign-in failed), 2 bad settings or
// an unconfirmed target (checked before any request is sent).

const settings = { ...process.env };

/** A setting as an integer in [min, max], or exit 2 naming it. */
function integerSetting(name, fallback, min, max) {
  const raw = settings[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    refuse(`${name} must be a whole number from ${min} to ${max} (got "${raw}")`);
  return value;
}

function refuse(message) {
  console.error(`load: ${message}`);
  process.exit(2);
}

const BASE_URL = (settings.BASE_URL ?? "http://localhost:3101").replace(/\/$/, "");
const USERNAME = settings.LOAD_USERNAME ?? "paolo";
// The published test password for synthetic data (docs/TEST-ACCOUNTS.md), not a secret.
const PASSWORD = settings.LOAD_PASSWORD ?? "Password123!";
const APPLICATIONS = integerSetting("APPLICATIONS", 100, 1, 100_000);
const CONCURRENCY = integerSetting("CONCURRENCY", 5, 1, 100);
const RATE_PER_MINUTE = integerSetting("RATE_PER_MINUTE", 120, 0, 10_000);
const MAX_ERROR_RATE = Number(settings.MAX_ERROR_RATE ?? 0.01);
if (!Number.isFinite(MAX_ERROR_RATE) || MAX_ERROR_RATE < 0 || MAX_ERROR_RATE > 1) {
  refuse(`MAX_ERROR_RATE must be a number from 0 to 1 (got "${settings.MAX_ERROR_RATE}")`);
}

let target;
try {
  target = new URL(BASE_URL);
} catch {
  refuse(`BASE_URL is not a URL (got "${BASE_URL}")`);
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!LOCAL_HOSTS.has(target.hostname) && settings.LOAD_CONFIRM !== target.host) {
  refuse(
    `${target.host} is not local: every application leaves synthetic rows that cannot be deleted. ` +
      `Re-run with LOAD_CONFIRM=${target.host} to load it.`,
  );
}

/** @type {Map<string, { ms: number[], statuses: Record<string, number> }>} */
const results = new Map();

async function timed(op, url, init) {
  const started = performance.now();
  let status = "network_error";
  let body = null;
  try {
    const res = await fetch(url, init);
    status = String(res.status);
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    // counted below as a network error
  }
  const ms = performance.now() - started;
  const r = results.get(op) ?? { ms: [], statuses: {} };
  r.ms.push(ms);
  r.statuses[status] = (r.statuses[status] ?? 0) + 1;
  results.set(op, r);
  return { status, body };
}

async function signIn() {
  const res = await fetch(`${BASE_URL}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("session="));
  if (!cookie) throw new Error("sign-in returned no session cookie");
  return cookie;
}

/** A synthetic walk-in, different every time (never a real person). */
function walkIn(n) {
  const run = Date.now().toString(36).slice(-5);
  return {
    fullName: `Load Test ${run}-${n}`,
    birthDate: "1990-05-15",
    governmentIdLast4: String(1000 + (n % 9000)).padStart(4, "0"),
    employer: "Synthetic Employer Inc.",
    employmentMonths: 36,
    monthlyIncome: "60000.00",
    monthlyObligations: "5000.00",
  };
}

async function oneApplication(n, cookie) {
  const headers = { "content-type": "application/json", cookie };
  const applicant = await timed("POST /applicants", `${BASE_URL}/applicants`, {
    method: "POST",
    headers,
    body: JSON.stringify(walkIn(n)),
  });
  if (applicant.status !== "201") return false;
  const created = await timed("POST /cases (submit)", `${BASE_URL}/cases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      applicantId: applicant.body.id,
      amount: "150000.00",
      tenorMonths: 24,
      purpose: "Home improvement",
      submit: true,
      consent: { creditBureauCheck: true, dataProcessing: true, termsVersion: "1.0" },
    }),
  });
  if (created.status !== "201") return false;
  await timed("GET /cases/:id", `${BASE_URL}/cases/${created.body.id}`, { headers });
  await timed("GET /cases (queue)", `${BASE_URL}/cases?view=queue`, { headers });
  return true;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}

async function main() {
  const cookie = await signIn();
  const gapMs = RATE_PER_MINUTE > 0 ? 60_000 / RATE_PER_MINUTE : 0;
  const started = performance.now();
  let next = 0;
  let completed = 0;
  let nextStartAt = started;

  async function worker() {
    for (;;) {
      const n = next++;
      if (n >= APPLICATIONS) return;
      const wait = nextStartAt - performance.now();
      nextStartAt = Math.max(nextStartAt, performance.now()) + gapMs;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (await oneApplication(n, cookie)) completed++;
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  const minutes = (performance.now() - started) / 60_000;

  let requests = 0;
  let failed = 0;
  let throttled = 0;
  const operations = {};
  for (const [op, r] of results) {
    const sorted = [...r.ms].sort((a, b) => a - b);
    requests += sorted.length;
    for (const [status, n] of Object.entries(r.statuses)) {
      if (!/^2\d\d$/.test(status)) failed += n;
      if (status === "429") throttled += n;
    }
    operations[op] = {
      count: sorted.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: Math.round(sorted.at(-1) ?? 0),
      statuses: r.statuses,
    };
  }
  const errorRate = requests ? failed / requests : 0;
  const report = {
    baseUrl: BASE_URL,
    settings: {
      applications: APPLICATIONS,
      concurrency: CONCURRENCY,
      ratePerMinute: RATE_PER_MINUTE,
    },
    applicationsCompleted: completed,
    applicationsPerMinute: Number((completed / minutes).toFixed(1)),
    requests,
    errorRate: Number(errorRate.toFixed(4)),
    throttled429: throttled,
    operations,
    nfr004: {
      target: "10,000 applications a day ≈ 6.9 a minute on average",
      averageMultipleAchieved: Number((completed / minutes / 6.94).toFixed(1)),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (errorRate > MAX_ERROR_RATE) {
    console.error(
      `load: error rate ${errorRate.toFixed(4)} is above MAX_ERROR_RATE ${MAX_ERROR_RATE}`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`load: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

import { ProviderUnavailableError } from "@loan/contracts";
import {
  type AttemptReport,
  backoffMs,
  CircuitBreaker,
  withRetry,
} from "../../src/providers/resilience";

const down = () => new ProviderUnavailableError("CREDIT_BUREAU", "OUTAGE", "down");

/** A fake clock and sleep: the policy runs without waiting. */
function harness() {
  let now = 1_000;
  const slept: number[] = [];
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}

describe("PR-1 retry with exponential backoff (unit)", () => {
  it("doubles the delay each retry, plus the jitter", () => {
    expect([1, 2, 3].map((k) => backoffMs(200, k, 0))).toEqual([200, 400, 800]);
    expect(backoffMs(200, 2, 37)).toBe(437);
  });

  it("returns on the first success and reports every attempt", async () => {
    const t = harness();
    const reports: AttemptReport[] = [];
    const fn = jest.fn().mockRejectedValueOnce(down()).mockResolvedValueOnce("report");
    const value = await withRetry(fn, {
      attempts: 3,
      baseMs: 100,
      sleep: t.sleep,
      jitter: () => 0,
      now: t.now,
      onAttempt: (r) => {
        reports.push(r);
      },
    });
    expect(value).toBe("report");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(t.slept).toEqual([100]);
    expect(reports.map((r) => [r.attempt, r.ok, r.failure])).toEqual([
      [1, false, "OUTAGE"],
      [2, true, null],
    ]);
  });

  it("gives up after the last attempt with the provider's error", async () => {
    const t = harness();
    const fn = jest.fn().mockRejectedValue(down());
    await expect(
      withRetry(fn, {
        attempts: 3,
        baseMs: 100,
        sleep: t.sleep,
        jitter: () => 0,
        now: t.now,
        onAttempt: () => {},
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(t.slept).toEqual([100, 200]);
  });

  it("never retries an error that is not a provider failure (a bug passes straight through)", async () => {
    const t = harness();
    const fn = jest.fn().mockRejectedValue(new TypeError("bug"));
    await expect(
      withRetry(fn, {
        attempts: 3,
        baseMs: 100,
        sleep: t.sleep,
        jitter: () => 0,
        now: t.now,
        onAttempt: () => {},
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("PR-3 circuit breaker (unit)", () => {
  const fail = () => Promise.reject(down());
  const ok = () => Promise.resolve("ok");

  it("opens after the threshold, refuses without calling while open, then lets one trial through", async () => {
    const t = harness();
    const breaker = new CircuitBreaker(2, 1_000, t.now);
    const shorted = jest.fn();
    await expect(breaker.run("CREDIT_BUREAU", fail, shorted)).rejects.toThrow();
    expect(breaker.state("CREDIT_BUREAU").state).toBe("CLOSED");
    await expect(breaker.run("CREDIT_BUREAU", fail, shorted)).rejects.toThrow();
    expect(breaker.state("CREDIT_BUREAU")).toMatchObject({ state: "OPEN", consecutiveFailures: 2 });

    const call = jest.fn(ok);
    await expect(breaker.run("CREDIT_BUREAU", call, shorted)).rejects.toThrow(/circuit opened/);
    expect(call).not.toHaveBeenCalled();
    expect(shorted).toHaveBeenCalledTimes(1);

    t.advance(1_000);
    expect(breaker.state("CREDIT_BUREAU").state).toBe("HALF_OPEN");
    await expect(breaker.run("CREDIT_BUREAU", call, shorted)).resolves.toBe("ok");
    expect(breaker.state("CREDIT_BUREAU")).toEqual({
      state: "CLOSED",
      consecutiveFailures: 0,
      openUntil: null,
    });
  });

  it("a failed half-open trial opens the circuit again at once", async () => {
    const t = harness();
    const breaker = new CircuitBreaker(1, 500, t.now);
    await expect(breaker.run("KYC_AML", fail, () => {})).rejects.toThrow();
    t.advance(500);
    await expect(breaker.run("KYC_AML", fail, () => {})).rejects.toThrow();
    expect(breaker.state("KYC_AML").state).toBe("OPEN");
  });

  it("only one half-open trial at a time; services have separate circuits", async () => {
    const t = harness();
    const breaker = new CircuitBreaker(1, 500, t.now);
    await expect(breaker.run("FRAUD", fail, () => {})).rejects.toThrow();
    t.advance(500);
    let release: (v: string) => void = () => {};
    const slow = () =>
      new Promise<string>((resolve) => {
        release = resolve;
      });
    const trial = breaker.run("FRAUD", slow, () => {});
    await expect(breaker.run("FRAUD", ok, () => {})).rejects.toThrow(/circuit/);
    release("ok");
    await expect(trial).resolves.toBe("ok");
    expect(breaker.state("CREDIT_BUREAU").state).toBe("CLOSED");
  });

  it("a successful call resets the count of failures", async () => {
    const t = harness();
    const breaker = new CircuitBreaker(2, 500, t.now);
    await expect(breaker.run("FRAUD", fail, () => {})).rejects.toThrow();
    await breaker.run("FRAUD", ok, () => {});
    await expect(breaker.run("FRAUD", fail, () => {})).rejects.toThrow();
    expect(breaker.state("FRAUD")).toMatchObject({ state: "CLOSED", consecutiveFailures: 1 });
  });
});

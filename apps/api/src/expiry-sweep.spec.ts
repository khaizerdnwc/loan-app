import type { ExpiryService } from "@loan/base";
import { Logger } from "@nestjs/common";
import { ExpirySweep } from "./expiry-sweep";

jest.mock("./config/env", () => ({ env: jest.fn(() => ({ EXPIRY_SWEEP_SECONDS: 300 })) }));
const { env } = jest.requireMock("./config/env") as { env: jest.Mock };

function sweepWith(expireStale: jest.Mock): ExpirySweep {
  return new ExpirySweep({ expireStale } as unknown as ExpiryService);
}

describe("ExpirySweep (W-2 scheduling)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("calls expireStale every EXPIRY_SWEEP_SECONDS, and stops when the module is destroyed", async () => {
    const expireStale = jest.fn().mockResolvedValue({ drafts: 0, offers: 0 });
    const sweep = sweepWith(expireStale);
    sweep.onModuleInit();
    await jest.advanceTimersByTimeAsync(299_000);
    expect(expireStale).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(expireStale).toHaveBeenCalledTimes(1);
    expect(expireStale.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    await jest.advanceTimersByTimeAsync(300_000);
    expect(expireStale).toHaveBeenCalledTimes(2);
    sweep.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(900_000);
    expect(expireStale).toHaveBeenCalledTimes(2);
  });

  it("0 turns the sweep off", async () => {
    env.mockReturnValueOnce({ EXPIRY_SWEEP_SECONDS: 0 });
    const expireStale = jest.fn();
    sweepWith(expireStale).onModuleInit();
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(expireStale).not.toHaveBeenCalled();
  });

  it("logs counts only, and a failure by its class only (never its message)", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const expireStale = jest
      .fn()
      .mockResolvedValueOnce({ drafts: 2, offers: 1 })
      .mockRejectedValueOnce(new TypeError("applicant Maria Santos"));
    const sweep = sweepWith(expireStale);
    await sweep.sweep();
    expect(log).toHaveBeenCalledWith("Expired 2 draft(s) and 1 offer(s).");
    await sweep.sweep();
    expect(error).toHaveBeenCalledWith("Expiry sweep failed (TypeError).");
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain("Maria");
  });

  it("does not start a sweep while the previous one is still running", async () => {
    const pending: { resolve?: (v: { drafts: number; offers: number }) => void } = {};
    const expireStale = jest.fn(
      () =>
        new Promise<{ drafts: number; offers: number }>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    const sweep = sweepWith(expireStale);
    const first = sweep.sweep();
    await sweep.sweep();
    expect(expireStale).toHaveBeenCalledTimes(1);
    pending.resolve?.({ drafts: 0, offers: 0 });
    await first;
    const third = sweep.sweep();
    expect(expireStale).toHaveBeenCalledTimes(2);
    pending.resolve?.({ drafts: 0, offers: 0 });
    await third;
  });
});

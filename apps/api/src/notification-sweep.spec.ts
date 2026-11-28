import type { NotificationReadsService, NotificationService } from "@loan/base";
import { Logger } from "@nestjs/common";
import { NotificationSweep } from "./notification-sweep";

jest.mock("./config/env", () => ({ env: jest.fn(() => ({ NOTIFICATION_SWEEP_SECONDS: 30 })) }));
const { env } = jest.requireMock("./config/env") as { env: jest.Mock };

const NONE = { sent: 0, waiting: 0, failed: 0 };

function sweepWith(dispatchPending: jest.Mock, alertBreaches: jest.Mock): NotificationSweep {
  return new NotificationSweep(
    { dispatchPending } as unknown as NotificationService,
    { alertBreaches } as unknown as NotificationReadsService,
  );
}

describe("NotificationSweep (NTF-1..NTF-3 scheduling)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("sends waiting messages and raises SLA alerts every NOTIFICATION_SWEEP_SECONDS, and stops when destroyed", async () => {
    const dispatch = jest.fn().mockResolvedValue(NONE);
    const breaches = jest.fn().mockResolvedValue(0);
    const sweep = sweepWith(dispatch, breaches);
    sweep.onModuleInit();
    await jest.advanceTimersByTimeAsync(29_000);
    expect(dispatch).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(breaches).toHaveBeenCalledTimes(1);
    expect(breaches.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    sweep.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(300_000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("0 turns the sweep off", async () => {
    env.mockReturnValueOnce({ NOTIFICATION_SWEEP_SECONDS: 0 });
    const dispatch = jest.fn();
    sweepWith(dispatch, jest.fn()).onModuleInit();
    await jest.advanceTimersByTimeAsync(3_600_000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("logs counts only, nothing when there was nothing to do, and a failure by its class only", async () => {
    const log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const dispatch = jest
      .fn()
      .mockResolvedValueOnce(NONE)
      .mockResolvedValueOnce({ sent: 3, waiting: 1, failed: 1 })
      .mockRejectedValueOnce(new TypeError("applicant Maria Santos"));
    const breaches = jest.fn().mockResolvedValueOnce(0).mockResolvedValue(2);
    const sweep = sweepWith(dispatch, breaches);
    await sweep.sweep();
    expect(log).not.toHaveBeenCalled();
    await sweep.sweep();
    expect(log).toHaveBeenLastCalledWith(
      "Sent 3 message(s), 1 waiting, 1 given up; 2 SLA alert(s).",
    );
    await sweep.sweep();
    expect(error).toHaveBeenCalledWith("Notification sweep failed: dispatch (TypeError).");
    // A failed dispatch does not stop the SLA alerts.
    expect(breaches).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenLastCalledWith(
      "Sent 0 message(s), 0 waiting, 0 given up; 2 SLA alert(s).",
    );
    expect(JSON.stringify([log.mock.calls, error.mock.calls])).not.toContain("Maria");
  });

  it("a failure in the SLA alerts is logged by its class and leaves the next sweep free to run", async () => {
    const error = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const dispatch = jest.fn().mockResolvedValue(NONE);
    const breaches = jest
      .fn()
      .mockRejectedValueOnce(new RangeError("case APP-1007 Maria"))
      .mockResolvedValue(0);
    const sweep = sweepWith(dispatch, breaches);
    await sweep.sweep();
    expect(error).toHaveBeenCalledWith("Notification sweep failed: SLA alerts (RangeError).");
    await sweep.sweep();
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(breaches).toHaveBeenCalledTimes(2);
  });

  it("does not start a sweep while the previous one is still running", async () => {
    const pending: { resolve?: (v: typeof NONE) => void } = {};
    const dispatch = jest.fn(
      () =>
        new Promise<typeof NONE>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    const sweep = sweepWith(dispatch, jest.fn().mockResolvedValue(0));
    const first = sweep.sweep();
    await sweep.sweep();
    expect(dispatch).toHaveBeenCalledTimes(1);
    pending.resolve?.(NONE);
    await first;
  });
});

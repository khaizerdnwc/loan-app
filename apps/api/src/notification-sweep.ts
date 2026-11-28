import { NotificationReadsService, NotificationService } from "@loan/base";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { env } from "./config/env";

/**
 * Runs the notification sweep every NOTIFICATION_SWEEP_SECONDS: borrower messages waiting in
 * the outbox go to the (simulated) gateway, and cases past their SLA raise one alert each
 * (PRD NTF-001/002, WF-003). 0 turns it off. Scheduled here, at the composition root, so the
 * domain stays free of timers. Logs counts only, never applicant data.
 */
@Injectable()
export class NotificationSweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSweep.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly notifications: NotificationService,
    private readonly reads: NotificationReadsService,
  ) {}

  onModuleInit(): void {
    const seconds = env().NOTIFICATION_SWEEP_SECONDS;
    if (seconds === 0) return;
    this.timer = setInterval(() => void this.sweep(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One sweep; a sweep still running when the next tick comes is not overlapped. */
  async sweep(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Each half runs however the other ends: a dispatch failure never stops SLA alerts.
      const sent = await this.step("dispatch", () => this.notifications.dispatchPending());
      const breaches = await this.step("SLA alerts", () => this.reads.alertBreaches(now));
      if (sent?.sent || sent?.failed || breaches) {
        this.logger.log(
          `Sent ${sent?.sent ?? 0} message(s), ${sent?.waiting ?? 0} waiting, ${sent?.failed ?? 0} given up; ${breaches ?? 0} SLA alert(s).`,
        );
      }
    } finally {
      this.running = false;
    }
  }

  /** One half of the sweep; a failure is logged by its class only, never its message. */
  private async step<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      // The next tick tries again; the message may hold data, so only the class is logged.
      this.logger.error(
        `Notification sweep failed: ${name} (${err instanceof Error ? err.name : "unknown"}).`,
      );
      return null;
    }
  }
}

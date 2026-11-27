import { ExpiryService } from "@loan/base";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { env } from "./config/env";

/**
 * Runs the expiry sweep (ExpiryService.expireStale) every EXPIRY_SWEEP_SECONDS: drafts
 * untouched for 30 days and offers unsigned for 5 days become EXPIRED (PRD INT-003). 0
 * turns it off. Scheduled here, at the composition root, so the domain stays free of timers.
 * Logs counts only, never applicant data.
 */
@Injectable()
export class ExpirySweep implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpirySweep.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly expiry: ExpiryService) {}

  onModuleInit(): void {
    const seconds = env().EXPIRY_SWEEP_SECONDS;
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
      const { drafts, offers } = await this.expiry.expireStale(now);
      if (drafts || offers) this.logger.log(`Expired ${drafts} draft(s) and ${offers} offer(s).`);
    } catch (err) {
      // The next tick tries again; the error's class only, never its message (it may hold data).
      this.logger.error(`Expiry sweep failed (${err instanceof Error ? err.name : "unknown"}).`);
    } finally {
      this.running = false;
    }
  }
}

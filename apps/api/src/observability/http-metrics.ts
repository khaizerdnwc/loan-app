import { Injectable } from "@nestjs/common";

/** Whether GET /metrics answers (METRICS_ENABLED); a token so a test can switch it on. */
export const METRICS_ENABLED = Symbol("METRICS_ENABLED");

/** Request duration buckets, in seconds (Prometheus convention: upper bounds, `le`). */
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Histogram {
  counts: number[];
  sum: number;
  count: number;
}

/**
 * Request counters and a duration histogram, in this process's memory (each replica keeps its
 * own; Prometheus sums them). Labels are the route pattern, never the path, so no id, query or
 * applicant value can become a label.
 */
@Injectable()
export class HttpMetrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Histogram>();

  record(method: string, route: string, status: number, seconds: number): void {
    const reqKey = JSON.stringify([method, route, String(status)]);
    this.requests.set(reqKey, (this.requests.get(reqKey) ?? 0) + 1);
    const durKey = JSON.stringify([method, route]);
    let h = this.durations.get(durKey);
    if (!h) {
      h = { counts: DURATION_BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.durations.set(durKey, h);
    }
    DURATION_BUCKETS.forEach((le, i) => {
      if (seconds <= le) (h as Histogram).counts[i] = ((h as Histogram).counts[i] ?? 0) + 1;
    });
    h.sum += seconds;
    h.count += 1;
  }

  /** The HTTP metrics in the Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [
      "# HELP http_requests_total Requests answered, by method, route pattern and status.",
      "# TYPE http_requests_total counter",
    ];
    for (const [key, n] of [...this.requests].sort()) {
      const [method, route, status] = JSON.parse(key) as string[];
      lines.push(`http_requests_total${labels({ method, route, status })} ${n}`);
    }
    lines.push(
      "# HELP http_request_duration_seconds Time to answer, by method and route pattern.",
      "# TYPE http_request_duration_seconds histogram",
    );
    for (const [key, h] of [...this.durations].sort()) {
      const [method, route] = JSON.parse(key) as string[];
      DURATION_BUCKETS.forEach((le, i) => {
        lines.push(
          `http_request_duration_seconds_bucket${labels({ method, route, le: String(le) })} ${h.counts[i]}`,
        );
      });
      lines.push(
        `http_request_duration_seconds_bucket${labels({ method, route, le: "+Inf" })} ${h.count}`,
        `http_request_duration_seconds_sum${labels({ method, route })} ${h.sum}`,
        `http_request_duration_seconds_count${labels({ method, route })} ${h.count}`,
      );
    }
    return `${lines.join("\n")}\n`;
  }
}

/** `{a="1",b="2"}` with label values escaped as the exposition format requires. */
export function labels(values: Record<string, string | undefined>): string {
  const parts = Object.entries(values).map(
    ([k, v]) =>
      `${k}="${(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
  );
  return `{${parts.join(",")}}`;
}

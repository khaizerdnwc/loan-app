import { randomUUID } from "node:crypto";
import type { HttpMetrics } from "./http-metrics";

/** A request id we accept from the caller: short, and only characters safe in a log line. */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = "x-request-id";

/** The caller's request id if it is well formed (the backoffice proxy sends one), else a new one. */
export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID.test(value) ? value : randomUUID();
}

interface Req {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  baseUrl?: string;
  route?: { path?: unknown };
  user?: { id?: string };
  requestId?: string;
}

interface Res {
  statusCode: number;
  setHeader(name: string, value: string): void;
  on(event: "finish", listener: () => void): void;
}

/** One request's log record: what was asked for and how it ended, and nothing a caller sent. */
export interface RequestLogRecord {
  msg: "request";
  requestId: string;
  method: string;
  /** The matched route pattern (`/cases/:id`), or "unmatched"; never the raw path or query. */
  route: string;
  status: number;
  durationMs: number;
  /** The signed-in staff member, when there was one. */
  staffId: string | null;
}

/** The route pattern Express matched, or "unmatched" (a 404, or rejected before routing). */
export function routePattern(req: Req): string {
  const path = req.route?.path;
  return typeof path === "string" ? `${req.baseUrl ?? ""}${path}` : "unmatched";
}

/**
 * Express middleware: give every request an id (echoed in `x-request-id`), and when the response
 * finishes, record it in the HTTP metrics and (except the /health probe) write one JSON line
 * to stdout. Logs never carry a body,
 * a query string, a path with ids, a header value or a token (non-negotiable 8): only the fields
 * of RequestLogRecord. The staff id is the session guard's verified user, not anything sent.
 */
export function requestLogging(
  metrics: HttpMetrics,
  write: (record: RequestLogRecord) => void = defaultWriter(),
): (req: Req, res: Res, next: () => void) => void {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    const requestId = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const route = routePattern(req);
      metrics.record(req.method, route, res.statusCode, seconds);
      // The liveness probe is counted, not logged: it would be most of the log.
      if (route === "/health") return;
      write({
        msg: "request",
        requestId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
        staffId: req.user?.id ?? null,
      });
    });
    next();
  };
}

/**
 * One bare JSON object per line on stdout (no Nest prefix or colours), so a platform's log
 * collector can parse every field.
 */
export function stdoutWriter(record: RequestLogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function defaultWriter(): (record: RequestLogRecord) => void {
  return stdoutWriter;
}

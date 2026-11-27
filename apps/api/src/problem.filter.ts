import { DomainError } from "@loan/base";
import { isProviderUnavailable } from "@loan/contracts";
import { type FieldError, ProblemCode, type ProblemDetails } from "@loan/core";
import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { QueryFailedError } from "typeorm";

interface ResponseLike {
  status(code: number): ResponseLike;
  type(t: string): ResponseLike;
  json(body: unknown): void;
}

const TITLES: Record<number, string> = {
  400: "Invalid request",
  401: "Sign-in required",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict",
  429: "Too many requests",
  502: "Bad gateway",
  503: "Service unavailable",
};

/**
 * Every error leaves as an RFC 9457 problem body with a stable `code` and a `detail`
 * written for the person at the screen. Unexpected errors are logged (without request
 * bodies) and answered with a generic 500: no stack, SQL or provider payload is returned.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ResponseLike>();
    const req = host.switchToHttp().getRequest<{ url?: string }>();
    const problem = this.toProblem(exception);
    problem.instance = req.url;
    res.status(problem.status).type("application/problem+json").json(problem);
  }

  toProblem(err: unknown): ProblemDetails {
    if (err instanceof DomainError) {
      return make(err.status, err.code, err.detail, err.errors);
    }
    if (isProviderUnavailable(err)) {
      return make(
        503,
        ProblemCode.ProviderUnavailable,
        "A simulated external service is unavailable. Try again shortly.",
      );
    }
    if (err instanceof ThrottlerException) {
      return make(429, ProblemCode.RateLimited, "Too many attempts. Wait a minute and try again.");
    }
    if (err instanceof BadRequestException) {
      const body = err.getResponse() as { message?: string | string[] };
      const messages = Array.isArray(body.message)
        ? body.message
        : [body.message ?? "Invalid request"];
      const errors: FieldError[] = messages.map((m) => ({
        field: m.split(" ")[0] ?? "body",
        message: m,
      }));
      return make(400, ProblemCode.Validation, "Check the highlighted fields.", errors);
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse() as { code?: ProblemCode; detail?: string };
      const code =
        body.code ??
        (status === 401
          ? ProblemCode.Unauthenticated
          : status === 403
            ? ProblemCode.Forbidden
            : status === 404
              ? ProblemCode.NotFound
              : ProblemCode.Validation);
      return make(status, code, body.detail ?? TITLES[status] ?? "Request failed.");
    }
    this.logger.error(logLine(err));
    return make(
      500,
      ProblemCode.Internal,
      "Something went wrong on our side. The request was not completed.",
    );
  }
}

function make(
  status: number,
  code: ProblemCode,
  detail: string,
  errors?: FieldError[],
): ProblemDetails {
  return {
    type: `https://whitebank.example/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title: TITLES[status] ?? "Error",
    status,
    detail,
    code,
    ...(errors?.length ? { errors } : {}),
  };
}

/**
 * What an unexpected error leaves in the log. Database errors can quote the offending value
 * (applicant data, AGENTS.md §2.8), so their messages lose anything in quotes and their stack;
 * other errors keep the stack.
 */
export function logLine(err: unknown): string {
  if (!(err instanceof Error)) return "Unexpected non-error thrown";
  if (err instanceof QueryFailedError) {
    const code = (err as QueryFailedError & { code?: string }).code ?? "unknown";
    return `${err.name} (${code}): ${err.message.replace(/"[^"]*"|'[^']*'/g, "<redacted>")}`;
  }
  return err.stack ?? `${err.name}: ${err.message}`;
}

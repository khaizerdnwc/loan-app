import type { FieldError, ProblemDetails } from "@loan/core";
import { formatAmountsInText } from "@loan/ui";

/**
 * The browser's client for the API, through this app's /api/* route. Every failure becomes
 * an ApiError whose message is the API's RFC 9457 `detail` — written for the person at the
 * screen — or a plain sentence when the reply is not a problem body. Status codes and JSON
 * never reach the UI.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FALLBACK: Record<number, string> = {
  400: "Some details are not valid. Check the form and try again.",
  401: "Your session has ended. Sign in again.",
  403: "Your role cannot do this.",
  404: "This case is not available to you.",
  409: "Someone else changed this case. Reload and try again.",
  429: "Too many attempts. Wait a minute and try again.",
  502: "The lending service is not answering. Try again in a moment.",
};

function isProblem(body: unknown): body is ProblemDetails {
  return typeof body === "object" && body !== null && "detail" in body && "status" in body;
}

/** Turn a failed response's body into an ApiError (exported for tests). */
export function toApiError(status: number, body: unknown): ApiError {
  if (isProblem(body)) {
    return new ApiError(status, body.code ?? "UNKNOWN", body.detail, body.errors ?? []);
  }
  return new ApiError(status, "UNKNOWN", FALLBACK[status] ?? "Something went wrong. Try again.");
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "You appear to be offline. Check your connection and try again.",
    );
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

/**
 * Fetch a file the API hands over as an attachment (a report CSV): its bytes and the file
 * name from Content-Disposition. A refusal becomes an ApiError, as with `api`.
 */
export async function apiFile(path: string): Promise<{ blob: Blob; fileName: string }> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(
      0,
      "NETWORK",
      "You appear to be offline. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = JSON.parse(await response.text());
    } catch {
      body = null;
    }
    throw toApiError(response.status, body);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
  return { blob: await response.blob(), fileName };
}

export function errorMessage(error: unknown): string {
  // A refusal may quote amounts ("₱120000.00 is above your approval limit"): format them.
  return error instanceof ApiError
    ? formatAmountsInText(error.message)
    : "Something went wrong. Try again.";
}

/**
 * The API's field errors (RFC 9457 `errors[]`) keyed by field, so a form can show each one
 * next to its input. Empty for any other error. A message that starts with its own field's name
 * (the validator's convention the problem filter reads the field from, e.g. "employmentMonths
 * Enter the months…") is shown without it when what follows is a sentence (capitalised); a
 * validator phrase ("amount must be a decimal string…") keeps its subject.
 */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const e of error.fieldErrors) {
    if (e.field in out) continue;
    const rest = e.message.startsWith(`${e.field} `) ? e.message.slice(e.field.length + 1) : "";
    // Only an officer sentence after the token ("Enter the months…") is shown on its own; a
    // validator phrase ("must be a decimal string…") needs its subject and stays whole.
    out[e.field] = /^\p{Lu}/u.test(rest) ? rest : e.message;
  }
  return out;
}

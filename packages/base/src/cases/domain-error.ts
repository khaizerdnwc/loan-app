import { type FieldError, ProblemCode } from "@loan/core";

/**
 * A refusal the domain decides: the API turns it into an RFC 9457 body with this status,
 * code and detail. `detail` is written for the person at the screen; nothing internal
 * (ids of other users, SQL, provider payloads) goes in it.
 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail: string,
    readonly errors?: FieldError[],
  ) {
    super(detail);
    this.name = "DomainError";
  }
}

export const notFound = (what = "case") =>
  new DomainError(404, ProblemCode.NotFound, `No such ${what}, or it is not visible to your role.`);

export const forbiddenRole = (detail = "Your role cannot do this.") =>
  new DomainError(403, ProblemCode.Forbidden, detail);

export const makerChecker = (detail: string) =>
  new DomainError(403, ProblemCode.MakerChecker, detail);

export const authorityExceeded = (detail: string) =>
  new DomainError(403, ProblemCode.AuthorityLimit, detail);

export const invalidState = (detail: string) =>
  new DomainError(409, ProblemCode.InvalidTransition, detail);

export const validation = (detail: string, errors: FieldError[] = []) =>
  new DomainError(400, ProblemCode.Validation, detail, errors);

export const overrideReasonRequired = (detail: string) =>
  new DomainError(400, ProblemCode.OverrideReasonRequired, detail, [
    { field: "overrideReason", message: detail },
  ]);

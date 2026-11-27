import { ThrottlerException } from "@nestjs/throttler";
import { QueryFailedError } from "typeorm";
import { logLine, ProblemFilter } from "./problem.filter";

describe("ProblemFilter: unexpected errors and throttling", () => {
  const filter = new ProblemFilter();

  it("an unexpected error is a generic 500 with no stack, SQL or message", () => {
    const problem = filter.toProblem(new Error("relation loan_case: secret detail"));
    expect(problem).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(JSON.stringify(problem)).not.toMatch(/secret detail|loan_case|at .*:\d+/);
  });

  it("a database error is a generic 500 too", () => {
    const err = new QueryFailedError("SELECT 1", [], new Error('invalid input: "Maria Santos"'));
    const problem = filter.toProblem(err);
    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toMatch(/Maria/);
  });

  it("throttling is a 429 RATE_LIMITED problem", () => {
    expect(filter.toProblem(new ThrottlerException())).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("the log line of a database error drops quoted values (no applicant data in logs)", () => {
    const err = new QueryFailedError(
      "INSERT …",
      [],
      new Error('invalid input syntax for type uuid: "Maria Santos"'),
    );
    const line = logLine(err);
    expect(line).toContain("QueryFailedError");
    expect(line).not.toContain("Maria");
    expect(line).toContain("<redacted>");
  });

  it("other errors keep their stack in the log", () => {
    expect(logLine(new Error("boom"))).toMatch(/Error: boom\n\s+at /);
  });
});

import { afterEach, vi } from "vitest";
import { ApiError, api, apiFile, errorMessage, fieldErrorsOf, toApiError } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("toApiError — problem details become sentences, never status codes or JSON", () => {
  it("uses the API's detail, code and field errors", () => {
    const e = toApiError(403, {
      type: "about:blank",
      title: "Forbidden",
      status: 403,
      code: "AUTHORITY_LIMIT_EXCEEDED",
      detail: "₱120,000.00 at grade C is above your authority (₱100,000.00, grades A–B).",
      errors: [{ field: "amount", message: "too high" }],
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("AUTHORITY_LIMIT_EXCEEDED");
    expect(e.message).toMatch(/above your authority/);
    expect(e.fieldErrors).toEqual([{ field: "amount", message: "too high" }]);
  });

  it.each([
    [401, /session has ended/],
    [403, /role cannot do this/],
    [404, /not available to you/],
    [409, /changed this case/],
    [429, /Too many attempts/],
    [502, /not answering/],
    [500, /Something went wrong/],
  ])("falls back to a plain sentence for a %i without a problem body", (status, message) => {
    expect(toApiError(status, "<html>oops</html>").message).toMatch(message);
  });
});

describe("problem bodies with missing parts", () => {
  it("uses UNKNOWN for a problem without a code and no field errors", () => {
    const e = toApiError(400, { status: 400, detail: "Check the form." });
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toBe("Check the form.");
    expect(e.fieldErrors).toEqual([]);
  });

  it("keys field errors by field (first message wins) and is empty for other errors", () => {
    const e = toApiError(400, {
      status: 400,
      detail: "Check.",
      errors: [
        { field: "amount", message: "too low" },
        { field: "amount", message: "second" },
        { field: "tenorMonths", message: "too long" },
      ],
    });
    expect(fieldErrorsOf(e)).toEqual({ amount: "too low", tenorMonths: "too long" });
    expect(fieldErrorsOf(new Error("x"))).toEqual({});
  });
});

describe("fieldErrorsOf — the leading field token (INT-7, WI-1)", () => {
  it("drops the token before an officer sentence, keeps a validator phrase whole", () => {
    const e = toApiError(400, {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: "Check the highlighted fields.",
      errors: [
        {
          field: "employmentMonths",
          message:
            "employmentMonths Enter the months with the employer as a whole number, 0 to 600.",
        },
        {
          field: "newCustomer.employmentMonths",
          message:
            "newCustomer.employmentMonths Enter the months with the employer as a whole number, 0 to 600.",
        },
        { field: "amount", message: "amount Enter the amount in pesos, with at most 2 decimals." },
        { field: "tenorMonths", message: "tenorMonths must not be greater than 600" },
        { field: "purpose", message: "Enter the purpose of the loan." },
        { field: "reason", message: "reasonable text without the token" },
      ],
    });
    expect(fieldErrorsOf(e)).toEqual({
      employmentMonths: "Enter the months with the employer as a whole number, 0 to 600.",
      "newCustomer.employmentMonths":
        "Enter the months with the employer as a whole number, 0 to 600.",
      amount: "Enter the amount in pesos, with at most 2 decimals.",
      // A validator phrase keeps its subject (a DTO not yet worded for officers).
      tenorMonths: "tenorMonths must not be greater than 600",
      purpose: "Enter the purpose of the loan.",
      reason: "reasonable text without the token",
    });
  });
});

describe("api()", () => {
  it("calls /api with JSON and returns the parsed body", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/cases?view=queue")).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases?view=queue",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws an ApiError with the problem detail on a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status: 409,
              title: "Conflict",
              detail: "This booking was already approved.",
              code: "CONFLICT",
            }),
            { status: 409 },
          ),
      ),
    );
    await expect(api("/cases/1/booking/approve", { method: "POST" })).rejects.toThrow(
      "This booking was already approved.",
    );
  });

  it("says the user is offline when the request cannot be sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const error = await api("/auth/me").catch((e: unknown) => e);
    expect(errorMessage(error)).toMatch(/offline/);
  });
});

describe("errorMessage — amounts in a refusal read like every other amount (U-2)", () => {
  it("formats the amounts the API wrote into its detail", () => {
    const e = new ApiError(
      403,
      "AUTHORITY_LIMIT_EXCEEDED",
      "₱120000.00 is above your approval limit of ₱100000.00",
      [],
    );
    expect(errorMessage(e)).toBe("₱120,000.00 is above your approval limit of ₱100,000.00");
  });
});

describe("apiFile() (RPT-006 downloads)", () => {
  it("says the browser is offline when the request cannot be sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const err = await apiFile("/reports/funnel.csv", "report.csv").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("NETWORK");
    expect(errorMessage(err)).toBe(
      "You appear to be offline. Check your connection and try again.",
    );
  });

  it("names the file with the fallback when the reply has no Content-Disposition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("a,b\r\n", { status: 200, headers: { "content-type": "text/csv" } }),
      ),
    );
    const { blob, fileName } = await apiFile("/reports/funnel.csv", "report.csv");
    expect(fileName).toBe("report.csv");
    // jsdom's Blob has no text(): the size is enough to show the bytes came through.
    expect(blob.size).toBe(5);
  });
});

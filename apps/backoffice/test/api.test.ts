import { afterEach, vi } from "vitest";
import { ApiError, api, errorMessage, fieldErrorsOf, toApiError } from "@/lib/api";

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

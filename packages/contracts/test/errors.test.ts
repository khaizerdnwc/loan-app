import { isProviderUnavailable, ProviderUnavailableError } from "../src";

describe("ProviderUnavailableError", () => {
  it("carries the service and the kind of failure, and is recognised by the guard", () => {
    const err = new ProviderUnavailableError("CREDIT_BUREAU", "TIMEOUT", "bureau timed out");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("PROVIDER_UNAVAILABLE");
    expect(err.service).toBe("CREDIT_BUREAU");
    expect(err.failure).toBe("TIMEOUT");
    expect(isProviderUnavailable(err)).toBe(true);
  });

  it("does not mistake another error for a provider failure", () => {
    expect(isProviderUnavailable(new Error("boom"))).toBe(false);
    expect(isProviderUnavailable({ code: "PROVIDER_UNAVAILABLE" })).toBe(false);
  });
});

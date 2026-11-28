import { ProviderUnavailableError } from "@loan/contracts";
import { failureInWords } from "../../src/notifications/notification.service";

describe("why a borrower message was not sent, in words (NTF-3)", () => {
  it.each([
    ["OUTAGE", "The email/SMS gateway (simulated) was unavailable."],
    ["TIMEOUT", "The email/SMS gateway (simulated) did not answer in time."],
    ["MALFORMED", "The email/SMS gateway (simulated) sent a reply that could not be read."],
  ] as const)("%s reads: %s", (failure, words) => {
    const err = new ProviderUnavailableError(
      "NOTIFICATIONS",
      failure,
      "provider said: applicant Maria Santos, +63 917 000 0000",
    );
    expect(failureInWords(err)).toBe(words);
  });

  it("an unexpected error says only that, never its text or class, and not what happens next", () => {
    const words = failureInWords(new TypeError("applicant Maria Santos"));
    expect(words).toBe(
      "The message could not be handed to the email/SMS gateway (simulated) because of an unexpected error.",
    );
    expect(words).not.toMatch(/Maria|TypeError|tried again/);
  });
});

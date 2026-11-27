import { CONSENT_TERMS_VERSION } from "@loan/core";
import { consentComplete } from "../../src/cases/consent";

describe("consentComplete (C-1, PRD INT-006)", () => {
  const full = {
    creditBureauCheck: true,
    dataProcessing: true,
    termsVersion: CONSENT_TERMS_VERSION,
  };

  it("is complete only with both consents for the current terms", () => {
    expect(consentComplete(full)).toBe(true);
  });

  it.each([
    ["no record", null],
    ["no bureau consent", { ...full, creditBureauCheck: false }],
    ["no data-processing consent", { ...full, dataProcessing: false }],
    ["an older terms version", { ...full, termsVersion: "0.9" }],
  ])("is incomplete with %s", (_label, consent) => {
    expect(consentComplete(consent)).toBe(false);
  });
});

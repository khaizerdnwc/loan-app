import { identityKey as screeningKey } from "@loan/contracts";
import { identityKey, normaliseName, sameIdentity } from "../../src/cases/applicant-identity";

const LORNA = { fullName: "Lorna Abad", birthDate: "1986-03-18", governmentIdLast4: "2950" };

describe("one identity key for duplicates (WI-2)", () => {
  it("folds case and spacing: '  lorna   ABAD ' is the same key as 'Lorna Abad'", () => {
    expect(identityKey({ ...LORNA, fullName: "  lorna   ABAD " })).toBe(identityKey(LORNA));
    expect(identityKey(LORNA)).toBe("lorna abad|1986-03-18|2950");
  });

  it("folds punctuation too (screening's key does not), so the match and the lock agree", () => {
    const hyphen = { ...LORNA, fullName: "Lorna-Abad" };
    expect(identityKey(hyphen)).toBe(identityKey(LORNA));
    expect(sameIdentity(hyphen, LORNA)).toBe(true);
    expect(normaliseName(hyphen.fullName)).toBe(normaliseName(LORNA.fullName));
    expect(screeningKey(hyphen)).not.toBe(screeningKey(LORNA));
  });

  it("another birth date or ID ending is another person", () => {
    expect(sameIdentity({ ...LORNA, governmentIdLast4: "2951" }, LORNA)).toBe(false);
    expect(sameIdentity({ ...LORNA, birthDate: "1986-03-19" }, LORNA)).toBe(false);
  });
});

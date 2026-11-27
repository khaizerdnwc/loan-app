import { applicationSchema, toCentavos, toDecimalString } from "@/lib/application-schema";

const valid = {
  applicantId: "app-maria",
  amount: "150000",
  tenorMonths: "24",
  purpose: "Home improvement",
};
const errorFor = (patch: Partial<typeof valid>) => {
  const result = applicationSchema.safeParse({ ...valid, ...patch });
  return result.success ? null : result.error.issues[0]?.message;
};

describe("new-application rules mirror the API's limits", () => {
  it("accepts a valid application", () => {
    expect(errorFor({})).toBeNull();
  });

  it.each([
    ["19999.99", /between/],
    ["500000.01", /between/],
    ["abc", /amount in pesos/],
    ["1.234", /amount in pesos/],
    [".5", /amount in pesos/],
    ["1234567890123", /amount in pesos/],
    ["1,2,3", /amount in pesos/],
    ["15,00,000", /amount in pesos/],
    ["", /Enter the amount/],
  ])("refuses the amount %p", (amount, message) => {
    expect(errorFor({ amount })).toMatch(message);
  });

  it.each(["20000", "500000.00", "150,000.50"])(
    "accepts the edge or formatted amount %p",
    (amount) => {
      expect(errorFor({ amount })).toBeNull();
    },
  );

  it.each([
    ["5", /6 to 36/],
    ["37", /6 to 36/],
    ["12.5", /whole number/],
  ])("refuses the tenor %p", (tenorMonths, message) => {
    expect(errorFor({ tenorMonths })).toMatch(message);
  });

  it.each(["6", "36"])("accepts the edge tenor %p", (tenorMonths) => {
    expect(errorFor({ tenorMonths })).toBeNull();
  });

  it("bounds the purpose: 3 to 120 characters", () => {
    expect(errorFor({ purpose: "ab" })).toMatch(/purpose/);
    expect(errorFor({ purpose: "abc" })).toBeNull();
    expect(errorFor({ purpose: "x".repeat(120) })).toBeNull();
    expect(errorFor({ purpose: "x".repeat(121) })).toMatch(/under 120/);
  });

  it("requires an applicant and a purpose", () => {
    expect(errorFor({ applicantId: "" })).toMatch(/applicant/);
    expect(errorFor({ purpose: " " })).toMatch(/purpose/);
  });
});

describe("amounts never pass through a float", () => {
  it("converts to whole centavos and back exactly", () => {
    expect(toCentavos("150,000.5")).toBe(15000050n);
    expect(toCentavos("0.1")).toBe(10n);
    expect(toDecimalString("150,000.5")).toBe("150000.50");
    expect(toDecimalString("120000")).toBe("120000.00");
  });
});

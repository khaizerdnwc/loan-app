import { Money } from "@loan/core";
import {
  documentFlags,
  draftActions,
  extractRefusal,
  incomeMismatch,
  mismatchTolerance,
  normaliseName,
  rowFlags,
} from "../../src/intake/intake-rules";

const m = (s: string) => Money.of(s);

describe("OCR mismatch rules (OCR-2, PRD DOC-002)", () => {
  it("uses the current rule set's income-mismatch tolerance (15%)", () => {
    expect(mismatchTolerance()).toBe("0.15");
  });

  it("compares exactly: 15% of the read income passes, one centavo more is a mismatch, either way", () => {
    expect(incomeMismatch(m("57500.00"), m("50000.00"), "0.15")).toBe(false);
    expect(incomeMismatch(m("57500.01"), m("50000.00"), "0.15")).toBe(true);
    expect(incomeMismatch(m("42500.00"), m("50000.00"), "0.15")).toBe(false);
    expect(incomeMismatch(m("42499.99"), m("50000.00"), "0.15")).toBe(true);
    expect(incomeMismatch(m("1.00"), m("0.00"), "0.15")).toBe(true);
    expect(incomeMismatch(m("0.00"), m("0.00"), "0.15")).toBe(false);
  });

  const application = {
    monthlyIncome: m("65000.00"),
    monthlyObligations: m("10000.00"),
    employer: "Luzon Freight Services Inc.",
  };

  it("flags income, employer and obligations against the application, and nothing when nothing was read", () => {
    expect(
      documentFlags(
        {
          monthlyIncome: m("50000.00"),
          employer: "LUZON  freight services, inc",
          recurringObligations: m("11500.00"),
        },
        application,
        "0.15",
      ),
    ).toEqual(["INCOME_MISMATCH"]);
    expect(
      documentFlags(
        { monthlyIncome: null, employer: "Other Corp", recurringObligations: m("11500.01") },
        application,
        "0.15",
      ),
    ).toEqual(["EMPLOYER_MISMATCH", "OBLIGATIONS_HIGHER"]);
    expect(
      documentFlags(
        { monthlyIncome: null, employer: null, recurringObligations: null },
        application,
        "0.15",
      ),
    ).toEqual([]);
    expect(
      documentFlags(
        { monthlyIncome: null, employer: null, recurringObligations: m("0.01") },
        { ...application, monthlyObligations: m("0.00") },
        "0.15",
      ),
    ).toEqual(["OBLIGATIONS_HIGHER"]);
  });

  it("normalises names for comparison", () => {
    expect(normaliseName("  Grace   VILLAMOR ")).toBe("grace villamor");
    expect(normaliseName("Cordillera Foods, Inc.")).toBe("cordillera foods inc");
  });
});

describe("intake draft rules (INT-1, INT-4, PRD INT-010)", () => {
  const complete = {
    governmentIdLast4: "5521",
    amount: m("50000.00"),
    tenorMonths: 12,
    declaredMonthlyIncome: m("32000.00"),
    documentMonthlyIncome: null,
  };

  it("flags a missing ID, missing terms, no customer match and a payslip that disagrees", () => {
    expect(rowFlags(complete, true, "0.15")).toEqual([]);
    expect(rowFlags({ ...complete, governmentIdLast4: null }, false, "0.15")).toEqual([
      "GOVERNMENT_ID_MISSING",
    ]);
    expect(rowFlags({ ...complete, tenorMonths: null }, true, "0.15")).toEqual(["TERMS_MISSING"]);
    expect(rowFlags(complete, false, "0.15")).toEqual(["NO_CUSTOMER_MATCH"]);
    expect(rowFlags({ ...complete, documentMonthlyIncome: m("25000.00") }, true, "0.15")).toEqual([
      "INCOME_MISMATCH",
    ]);
  });

  it("offers confirm and discard only to the loan officer, only while the draft waits", () => {
    expect(draftActions("LOAN_OFFICER", "PENDING_REVIEW")).toEqual(["CONFIRM", "DISCARD"]);
    expect(draftActions("LOAN_OFFICER", "CONFIRMED")).toEqual([]);
    expect(draftActions("COMPLIANCE", "PENDING_REVIEW")).toEqual([]);
  });
});

describe("when OCR may read a case document (OCR-3)", () => {
  const received = {
    documentType: "BANK_STATEMENTS_3M" as const,
    status: "RECEIVED" as const,
    uploadReference: "DOC-00000001",
  };

  it("reads a received or verified document of a case in review, once per upload", () => {
    expect(extractRefusal("REVIEW", received, false)).toBeNull();
    expect(extractRefusal("INFO_REQUESTED", { ...received, status: "VERIFIED" }, false)).toBeNull();
    expect(extractRefusal("REVIEW", received, true)).toBe(
      "Bank statements, last 3 months has already been read with OCR.",
    );
    expect(
      extractRefusal("REVIEW", { ...received, status: "REQUESTED", uploadReference: null }, false),
    ).toBe("Bank statements, last 3 months has not been received, so there is nothing to read.");
    expect(extractRefusal("REVIEW", { ...received, status: "REJECTED" }, false)).toContain(
      "has not been received",
    );
    expect(extractRefusal("APPROVAL", received, false)).toBe(
      "Documents are read with OCR while the case is in review.",
    );
  });
});

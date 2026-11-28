import type { EligibilityPreCheckView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { PreCheckForm } from "@/components/eligibility/pre-check-form";

afterEach(() => vi.unstubAllGlobals());

const review: EligibilityPreCheckView = {
  productCode: "PL",
  ruleSetVersion: "RS-X",
  outcome: "REVIEW_LIKELY",
  checks: [
    { id: "PC-AGE", name: "Applicant age 21–65", result: "PASS", value: "age 35" },
    {
      id: "PC-DTI",
      name: "Debt-to-income at or below 40.0%",
      result: "REVIEW",
      value: "DTI 43.0%",
    },
    {
      id: "PC-AMOUNT",
      name: "Amount within the automatic approval limit",
      result: "PASS",
      value: "limit 300000.00",
    },
    {
      id: "PC-AFFORD",
      name: "Amount affordable within the debt-service limit",
      result: "REVIEW",
      value: "up to 79000.00 at the highest rate",
    },
  ],
  monthlyRateRange: { from: "0.0120", to: "0.0200" },
  affordable: { atBestRate: "91000.00", atWorstRate: "79000.00" },
  caveat: "Indicative only, from the figures given: not a decision or an offer.",
};

async function fill() {
  await userEvent.type(screen.getByLabelText("Amount (pesos)"), "250000");
  await userEvent.type(screen.getByLabelText("Tenor (months)"), "24");
  await userEvent.type(screen.getByLabelText("Age (years)"), "35");
  await userEvent.type(screen.getByLabelText("Monthly income (pesos)"), "70000");
  await userEvent.type(screen.getByLabelText("Monthly obligations (pesos)"), "30100");
  await userEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
}

describe("PreCheckForm (EL-2)", () => {
  it("posts the stated figures and shows the outcome, each check, the ranges and the caveat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(review), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreCheckForm />);
    await fill();

    expect(await screen.findByText("Review likely")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/eligibility/pre-check");
    expect(JSON.parse(String(init.body))).toEqual({
      amount: "250000.00",
      tenorMonths: 24,
      ageYears: 35,
      monthlyIncome: "70000.00",
      monthlyObligations: "30100.00",
    });
    const checks = screen.getByRole("list", { name: "Policy checks" });
    expect(within(checks).getAllByText("Review")).toHaveLength(2);
    expect(checks).toHaveTextContent("up to ₱79,000.00 at the highest rate");
    expect(checks).toHaveTextContent("limit ₱300,000.00");
    expect(
      screen.getByText("Affordable amount (engine), best grade rate").nextSibling,
    ).toHaveTextContent("₱91,000.00");
    expect(
      screen.getByText("Affordable amount (engine), highest grade rate").nextSibling,
    ).toHaveTextContent("₱79,000.00");
    expect(
      screen.getByText(
        /Indicative: the most these figures can repay within the debt-service limit of RS-X, up to the amount asked\. Not an offer\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Monthly rate, by grade").nextSibling).toHaveTextContent(
      "1.20% / month to 2.00% / month",
    );
    expect(screen.getByText(/not a decision or an offer/)).toBeInTheDocument();
  });

  it("nothing affordable reads None with a sentence, never ₱0.00", async () => {
    const none = {
      ...review,
      affordable: { atBestRate: "0.00", atWorstRate: "0.00" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(none), { status: 200 })),
    );
    render(<PreCheckForm />);
    await fill();
    expect(
      (await screen.findByText("Affordable amount (engine), best grade rate")).nextSibling,
    ).toHaveTextContent("None");
    expect(screen.getByText(/Nothing is affordable at any grade's rate/)).toBeInTheDocument();
    expect(screen.queryByText(/₱0\.00/)).toBeNull();
  });

  it("an empty tenor is caught in staff words before anything is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PreCheckForm />);
    await userEvent.type(screen.getByLabelText("Amount (pesos)"), "150000");
    await userEvent.type(screen.getByLabelText("Age (years)"), "31");
    await userEvent.type(screen.getByLabelText("Monthly income (pesos)"), "78000");
    await userEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
    expect(screen.getByLabelText("Tenor (months)")).toHaveAccessibleDescription("Enter the tenor.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the API's field errors and its message, and no stale result", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad request",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: "Check the highlighted fields.",
      errors: [{ field: "amount", message: "Amount must be between ₱20,000 and ₱500,000." }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(problem), { status: 400 })),
    );
    render(<PreCheckForm />);
    await fill();
    expect(await screen.findByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(screen.getByLabelText("Amount (pesos)")).toHaveAccessibleDescription(
      /between ₱20,000 and ₱500,000/,
    );
    expect(screen.queryByRole("list", { name: "Policy checks" })).toBeNull();
  });
});

import type { CaseDetail } from "@loan/core";
import { render, screen } from "@testing-library/react";
import { OutcomeBanner } from "@/components/case/outcome-banner";

function caseWith(
  status: CaseDetail["status"],
  outcome: "AUTO_APPROVE" | "REFER",
  closedFrom: CaseDetail["closedFrom"] = null,
): CaseDetail {
  return {
    status,
    closedFrom,
    decision: {
      outcome,
      score: 742,
      grade: "A",
      referralTriggers: ["Thin file"],
      reasonCodes: [],
    },
  } as unknown as CaseDetail;
}

describe("OutcomeBanner (W-1, W-2)", () => {
  it("shows the green auto-approval on a live case", () => {
    render(<OutcomeBanner detail={caseWith("OFFER", "AUTO_APPROVE")} />);
    expect(screen.getByText("Auto-approved.").parentElement).toHaveAttribute("data-tone", "ok");
  });

  it.each([
    ["WITHDRAWN", "AUTO_APPROVE", "OFFER", "Auto-approved, then withdrawn."],
    ["WITHDRAWN", "REFER", "APPROVAL", "Referred to human review, then withdrawn."],
    ["EXPIRED", "AUTO_APPROVE", "OFFER", "Auto-approved; the offer expired unsigned."],
  ] as const)("on a %s case after %s it says so neutrally", (status, outcome, from, text) => {
    render(<OutcomeBanner detail={caseWith(status, outcome, from)} />);
    const banner = screen.getByText(text).parentElement as HTMLElement;
    expect(banner).toHaveTextContent("The application is closed.");
    expect(banner).toHaveAttribute("data-tone", "neutral");
    expect(screen.queryByText("Auto-approved.")).not.toBeInTheDocument();
  });
});

import type { CaseSummary } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import { CaseTable } from "@/components/case-table";

const base: CaseSummary = {
  id: "c1",
  reference: "APP-1001",
  applicantName: "Joel Reyes",
  productCode: "PL",
  requestedAmount: "200000.00",
  requestedTenorMonths: 36,
  status: "REVIEW",
  outcome: "REFER",
  grade: "C",
  escalated: false,
  createdAt: "2026-11-27T02:00:00.000Z",
  updatedAt: "2026-11-27T02:00:00.000Z",
};

const cell = (row: number, column: string) => {
  const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
  const r = screen.getAllByRole("row")[row + 1] as HTMLElement;
  return within(r).getAllByRole("cell")[headers.indexOf(column)] as HTMLElement;
};

describe("the case table", () => {
  it("has the prototype's columns in order", () => {
    render(<CaseTable cases={[base]} empty="None." />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Applicant",
      "Product",
      "Amount",
      "Stage",
      "Decision",
      "Grade",
      "Updated",
    ]);
  });

  it("names the product, and shows an unknown product's code as given", () => {
    render(<CaseTable cases={[base, { ...base, id: "c2", productCode: "HL" }]} empty="None." />);
    expect(cell(0, "Product")).toHaveTextContent("Personal loan");
    expect(cell(1, "Product")).toHaveTextContent("HL");
  });

  it("shows the amount through formatPeso with the tenor on a second line", () => {
    render(<CaseTable cases={[base]} empty="None." />);
    const amount = cell(0, "Amount");
    expect(amount).toHaveTextContent("₱200,000.00");
    expect(within(amount).getByText("36 months").tagName).toBe("P");
  });

  it("shows the applicant with initials, a link to the case and the reference", () => {
    render(<CaseTable cases={[base]} empty="None." />);
    const applicant = cell(0, "Applicant");
    expect(within(applicant).getByRole("link", { name: "Joel Reyes" })).toHaveAttribute(
      "href",
      "/cases/c1",
    );
    expect(applicant).toHaveTextContent("JR");
    expect(applicant).toHaveTextContent("APP-1001");
  });

  it("makes the whole row open the case, through the one real link in it", () => {
    render(<CaseTable cases={[base]} empty="None." />);
    const row = screen.getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveAttribute("data-clickable", "true");
    const links = within(row).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("data-row-link");
  });

  it("sets only the reference in monospace, not the amount", () => {
    render(<CaseTable cases={[base]} empty="None." />);
    expect(screen.getByText("APP-1001").className).toMatch(/font-mono/);
    expect(screen.getByText("₱200,000.00").className).not.toMatch(/font-mono/);
  });
});

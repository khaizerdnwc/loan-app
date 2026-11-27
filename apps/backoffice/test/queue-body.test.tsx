import type { CaseStatus, CaseSummary, Role } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { QueueBody, type StageFilter } from "@/components/queue-body";

function summary(id: string, status: CaseStatus, patch: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id,
    reference: `APP-${id}`,
    applicantName: `Applicant ${id}`,
    productCode: "PL",
    requestedAmount: "150000.00",
    requestedTenorMonths: 24,
    status,
    outcome: status === "DRAFT" ? null : "REFER",
    reason: status === "DRAFT" ? null : "Thin bureau file",
    reasonCount: status === "DRAFT" ? 0 : 1,
    grade: status === "DRAFT" ? null : "C",
    escalated: false,
    createdAt: "2026-11-27T02:00:00.000Z",
    updatedAt: "2026-11-27T02:00:00.000Z",
    ...patch,
  };
}

/** The body with its own filter state, as the page holds it. */
function Harness({
  staffRole,
  items,
  initial = "ALL",
}: {
  staffRole: Role;
  items: CaseSummary[];
  initial?: StageFilter;
}) {
  const [stage, setStage] = useState<StageFilter>(initial);
  return (
    <QueueBody
      staffRole={staffRole}
      items={items}
      stage={stage}
      onStage={setStage}
      empty="Queue is clear."
    />
  );
}

const figures = () =>
  within(screen.getByRole("list", { name: "Queue figures" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

const rows = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getByRole("link").textContent);

const officerQueue = [
  summary("1", "REVIEW"),
  summary("2", "DRAFT"),
  summary("3", "REVIEW"),
  summary("4", "REVIEW"),
];

describe("queue figures and the stage filter", () => {
  it("counts the queue and each stage it holds, in lifecycle order", () => {
    render(<Harness staffRole="LOAN_OFFICER" items={officerQueue} />);
    expect(figures()).toEqual(["In my queue4", "Draft1", "In review3"]);
  });

  it("filters the table to the chosen stage, and back to all", async () => {
    render(<Harness staffRole="LOAN_OFFICER" items={officerQueue} />);
    const filter = screen.getByRole("group", { name: "Filter by stage" });
    expect(within(filter).getByRole("button", { name: /^All/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(filter).getByRole("button", { name: /^Draft/ }));
    expect(within(filter).getByRole("button", { name: /^Draft/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(rows()).toEqual(["Applicant 2"]);
    await userEvent.click(within(filter).getByRole("button", { name: /^All/ }));
    expect(rows()).toHaveLength(4);
  });

  it("a single-stage queue shows only the total and no filter", () => {
    render(
      <Harness
        staffRole="LOAN_OPERATIONS"
        items={[summary("1", "BOOKING"), summary("2", "BOOKING")]}
      />,
    );
    expect(figures()).toEqual(["In my queue2"]);
    expect(screen.queryByRole("group", { name: "Filter by stage" })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it("a chosen stage that has left the queue falls back to all, so nothing is hidden", () => {
    render(
      <Harness
        staffRole="LOAN_OFFICER"
        initial="DRAFT"
        items={[summary("1", "REVIEW"), summary("3", "APPROVAL")]}
      />,
    );
    expect(rows()).toEqual(["Applicant 1", "Applicant 3"]);
    expect(
      within(screen.getByRole("group", { name: "Filter by stage" })).getByRole("button", {
        name: /^All/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows Escalated only on the approver's queue, where escalated cases land", () => {
    const { unmount } = render(
      <Harness
        staffRole="APPROVER"
        items={[summary("1", "APPROVAL", { escalated: true }), summary("2", "APPROVAL")]}
      />,
    );
    expect(figures()).toEqual(["In my queue2", "Escalated1from a lower approval limit"]);
    unmount();
    render(<Harness staffRole="LOAN_OFFICER" items={officerQueue} />);
    expect(figures().some((f) => f?.startsWith("Escalated"))).toBe(false);
  });

  it("lays the figures out as the prototype's grid: one a row on a phone, two, then four", () => {
    render(<Harness staffRole="LOAN_OFFICER" items={officerQueue} />);
    const list = screen.getByRole("list", { name: "Queue figures" });
    expect(list).toHaveAttribute("data-layout", "figures-grid");
    expect(list.className).toMatch(/(^| )grid-cols-1( |$)/);
    expect(list.className).toMatch(/min-\[521px\]:grid-cols-2/);
    expect(list.className).toMatch(/min-\[1101px\]:grid-cols-4/);
    // No fixed card width: a card fills its column at 390px.
    for (const li of within(list).getAllByRole("listitem")) {
      expect(li.className).not.toMatch(/max-w-/);
    }
  });
});

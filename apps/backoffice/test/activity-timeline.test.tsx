import type { ActivityView } from "@loan/core";
import { render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { ActivityTimeline } from "@/components/case/activity-timeline";

afterEach(() => vi.unstubAllGlobals());

const event = (patch: Partial<ActivityView>): ActivityView => ({
  id: "e1",
  actorName: "Paolo Tan",
  actorRole: "LOAN_OFFICER",
  action: "CREATED",
  summary: "",
  fromStatus: null,
  toStatus: "DRAFT",
  details: {},
  createdAt: "2026-11-28T01:00:00.000Z",
  ...patch,
});

describe("ActivityTimeline", () => {
  it("shows the amounts in the API's summaries through formatPeso, history included", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            event({ summary: "Created draft APP-1001: ₱20000.00 over 12 months for Liza Ramos." }),
            event({
              id: "e2",
              summary: "Approval refused: ₱120000.00 is above your approval limit of ₱100000.00",
              createdAt: "2026-11-28T02:00:00.000Z",
            }),
          ]),
          { status: 200 },
        ),
      ),
    );
    render(<ActivityTimeline caseId="case-1" version={0} />);
    expect(
      await screen.findByText("Created draft APP-1001: ₱20,000.00 over 12 months for Liza Ramos."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approval refused: ₱120,000.00 is above your approval limit of ₱100,000.00"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/₱20000\.00/)).toBeNull();
  });

  it("lists the newest event first", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify([
              event({ id: "old", summary: "First." }),
              event({ id: "new", summary: "Second.", createdAt: "2026-11-28T03:00:00.000Z" }),
            ]),
            { status: 200 },
          ),
        ),
    );
    render(<ActivityTimeline caseId="case-1" version={0} />);
    await screen.findByText("Second.");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Second.");
  });
});

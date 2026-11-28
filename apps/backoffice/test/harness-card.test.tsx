import type { HarnessRunView, ModelRegistryView } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { HarnessCard } from "@/components/models/harness-card";

/** HX-3: the rule-set test harness card (PRD DEC-004). */
afterEach(() => vi.unstubAllGlobals());

const registry = {
  scorecards: [],
  prohibitedFeatures: [],
  ruleSets: [
    { version: "RS-PL-4", current: false, decisions: 3, firstUsedAt: null, lastUsedAt: null },
    { version: "RS-PL-5", current: true, decisions: 9, firstUsedAt: null, lastUsedAt: null },
  ],
} as unknown as ModelRegistryView;

const run = (patch: Partial<HarnessRunView> = {}): HarnessRunView => ({
  candidate: "RS-PL-4",
  baseline: "RS-PL-5",
  period: { from: "2026-10-30", to: "2026-11-28" },
  cap: 300,
  decisionsInPeriod: 3,
  compared: 2,
  notComparable: [{ caseReference: "APP-1003", reason: "RS-PL-5 needs a fraud check result" }],
  outcomes: [
    { outcome: "AUTO_APPROVE", baseline: 0, candidate: 1 },
    { outcome: "REFER", baseline: 2, candidate: 1 },
    { outcome: "AUTO_DECLINE", baseline: 0, candidate: 0 },
  ],
  movement: [
    { from: "REFER", to: "AUTO_APPROVE", count: 1 },
    { from: "REFER", to: "REFER", count: 1 },
  ],
  changed: [
    {
      caseReference: "APP-1001",
      baselineOutcome: "REFER",
      candidateOutcome: "AUTO_APPROVE",
      reasonsAdded: [],
      reasonsRemoved: [{ code: "R27", staff: "Low model confidence (wording from the API)" }],
      defaults: [],
    },
  ],
  withDefaults: [
    {
      caseReference: "APP-1002",
      baselineOutcome: "REFER",
      candidateOutcome: "REFER",
      reasonsAdded: [],
      reasonsRemoved: [],
      defaults: ["external decision engine: not used (not recorded)"],
    },
  ],
  ...patch,
});

describe("HarnessCard (HX-3)", () => {
  it("says it compares and never publishes, runs the comparison and shows the cap and every list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(run()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HarnessCard registry={registry} />);
    expect(screen.getByText("Compares, never publishes.")).toBeInTheDocument();
    expect(
      screen.getByText(/does not publish a rule set, change a case or call a provider/),
    ).toBeInTheDocument();
    // The live rule set is the default comparison; the candidate another one.
    expect(screen.getByLabelText("Candidate rule set")).toHaveValue("RS-PL-4");
    expect(screen.getByLabelText("Compared with")).toHaveValue("RS-PL-5");

    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    const result = await screen.findByRole("region", { name: "Harness result" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/models/harness");
    expect(JSON.parse(String(init.body))).toEqual({ candidate: "RS-PL-4", baseline: "RS-PL-5" });
    expect(
      within(result).getByText(/At most 300 decisions are replayed per run/),
    ).toBeInTheDocument();
    expect(within(result).getByText("APP-1001")).toBeInTheDocument();
    // The code in monospace, with its wording from the API.
    const code = within(result).getByText("R27");
    expect(code.className).toMatch(/font-mono/);
    expect(code.closest("li")).toHaveTextContent(
      "Removed R27 · Low model confidence (wording from the API)",
    );
    expect(
      within(result).getByText("external decision engine: not used (not recorded)"),
    ).toBeInTheDocument();
    expect(within(result).getByText("RS-PL-5 needs a fraud check result")).toBeInTheDocument();
  });

  it("says when the cap cut the period short", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(run({ decisionsInPeriod: 412 })), { status: 200 }),
        ),
    );
    render(<HarnessCard registry={registry} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(
      await screen.findByText(
        /412 cases had a decision in the period; only the newest 300 \(the cap\) were replayed/,
      ),
    ).toBeInTheDocument();
  });

  it("refuses comparing a rule set with itself before sending, and shows the API's field errors", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad request",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: "Check the dates.",
      errors: [{ field: "from", message: "Enter a real date." }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(problem), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HarnessCard registry={registry} />);
    await userEvent.selectOptions(screen.getByLabelText("Candidate rule set"), "RS-PL-5");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByText(/other than the one it is compared with/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Candidate rule set"), "RS-PL-4");
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByText("Enter a real date.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Check the dates.");
  });

  it("a refused run clears the earlier result, so it cannot be mistaken for this one", async () => {
    const problem = {
      type: "about:blank",
      title: "Bad request",
      status: 400,
      code: "VALIDATION_FAILED",
      detail: "The period is too long.",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(run()), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(problem), { status: 400 })),
    );
    render(<HarnessCard registry={registry} />);
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("region", { name: "Harness result" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The period is too long.");
    expect(screen.queryByRole("region", { name: "Harness result" })).toBeNull();
  });
});

import type { AuditEventView, AuditLogPage } from "@loan/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AuditLog } from "@/components/audit/audit-log";
import { ChainCheck } from "@/components/audit/chain-check";
import { auditQuery, NO_AUDIT_FILTERS } from "@/lib/audit";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const entry = (patch: Partial<AuditEventView>): AuditEventView => ({
  seq: 7,
  occurredAt: "2026-11-28T01:00:00.000Z",
  actorId: "STF-PAOLO",
  actorName: "Paolo Tan",
  actorRole: "LOAN_OFFICER",
  action: "CASE_CREATED",
  caseId: "case-1",
  caseReference: "APP-1001",
  caseHidden: false,
  summary: "Created draft APP-1001.",
  details: {},
  hash: "a".repeat(64),
  ...patch,
});

/** Answer /audit/actions, then each /audit/events call in order. */
function stubApi(pages: (AuditLogPage | Response)[]) {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith("/api/audit/actions")) {
      return Promise.resolve(json(["CASE_CREATED", "SIGN_IN_FAILED"]));
    }
    const next = pages.shift();
    return Promise.resolve(next instanceof Response ? next : json(next));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const eventCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/audit/events"));

describe("auditQuery", () => {
  it("sends only the filters that are set, trimmed, with the page", () => {
    expect(auditQuery(NO_AUDIT_FILTERS)).toBe("/audit/events?limit=50");
    expect(
      auditQuery(
        {
          actor: " Paolo ",
          action: "CASE_CREATED",
          from: "2026-11-01",
          to: "",
          caseReference: "APP-1001",
        },
        42,
      ),
    ).toBe(
      "/audit/events?actor=Paolo&action=CASE_CREATED&from=2026-11-01&case=APP-1001&before=42&limit=50",
    );
  });
});

describe("AuditLog (AUD-6, AUD-7)", () => {
  it("lists entries, searches with the filters, and pages to older entries", async () => {
    const fetchMock = stubApi([
      { items: [entry({ seq: 9 }), entry({ seq: 8 })], nextBefore: 8 },
      {
        items: [entry({ seq: 2, action: "SIGN_IN_FAILED", caseId: null, caseReference: null })],
        nextBefore: null,
      },
      { items: [entry({ seq: 1 })], nextBefore: null },
    ]);
    render(<AuditLog canOpenCases />);

    expect(await screen.findAllByText("Created draft APP-1001.")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "APP-1001" })[0]).toHaveAttribute(
      "href",
      "/cases/case-1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    await vi.waitFor(() =>
      expect(within(screen.getByRole("table")).getByText("SIGN_IN_FAILED")).toBeInTheDocument(),
    );
    expect(eventCalls(fetchMock)[1]).toContain("before=8");

    await userEvent.type(screen.getByLabelText("Person"), "Paolo");
    await userEvent.type(screen.getByLabelText("Case reference"), "APP-1001");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await vi.waitFor(() => expect(eventCalls(fetchMock)).toHaveLength(3));
    expect(eventCalls(fetchMock)[2]).toBe("/api/audit/events?actor=Paolo&case=APP-1001&limit=50");
    expect(screen.queryByRole("button", { name: "Show older entries" })).not.toBeInTheDocument();
  });

  it("for the administrator: no case, no case filter, and hidden case content is said so", async () => {
    stubApi([
      {
        items: [
          entry({
            summary: null,
            details: null,
            caseId: null,
            caseReference: null,
            caseHidden: true,
          }),
        ],
        nextBefore: null,
      },
    ]);
    render(<AuditLog canOpenCases={false} />);
    expect(
      await screen.findByText("Case details are visible to Compliance only."),
    ).toBeInTheDocument();
    expect(screen.getByText("A case (hidden)")).toBeInTheDocument();
    expect(screen.queryByText("APP-1001")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Case reference")).not.toBeInTheDocument();
  });

  it("names actions in words in the filter and the table, keeping the code", async () => {
    stubApi([{ items: [entry({})], nextBefore: null }]);
    render(<AuditLog canOpenCases />);
    expect(await screen.findByRole("option", { name: "Sign-in refused" })).toHaveValue(
      "SIGN_IN_FAILED",
    );
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Application created")).toBeInTheDocument();
    expect(within(table).getByText("CASE_CREATED")).toBeInTheDocument();
  });

  it("says when the list of actions cannot be loaded, and disables that filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.startsWith("/api/audit/actions")
            ? json(
                {
                  type: "about:blank",
                  title: "Unavailable",
                  status: 503,
                  code: "PROVIDER_UNAVAILABLE",
                  detail: "The lending service is not answering.",
                },
                503,
              )
            : json({ items: [], nextBefore: null }),
        ),
      ),
    );
    render(<AuditLog canOpenCases />);
    expect(await screen.findByText(/list of actions could not be loaded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toBeDisabled();
  });

  it("shows the API's field error next to the filter it is about", async () => {
    stubApi([
      { items: [], nextBefore: null },
      json(
        {
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          code: "VALIDATION_FAILED",
          detail: "The date range ends before it starts.",
          errors: [{ field: "to", message: "Choose a date on or after the start date." }],
        },
        400,
      ),
    ]);
    render(<AuditLog canOpenCases />);
    expect(await screen.findByText("No entries match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The date range ends before it starts.",
    );
    expect(screen.getByText("Choose a date on or after the start date.")).toBeInTheDocument();
  });
});

describe("AuditLog first load (AUD-6)", () => {
  it("when the first load fails, says so with Try again, which loads the entries", async () => {
    const fetchMock = stubApi([
      json(
        {
          type: "about:blank",
          title: "Unavailable",
          status: 503,
          code: "PROVIDER_UNAVAILABLE",
          detail: "The lending service is not answering.",
        },
        503,
      ),
      { items: [entry({})], nextBefore: null },
    ]);
    render(<AuditLog canOpenCases />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The lending service is not answering.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Created draft APP-1001.")).toBeInTheDocument();
    expect(eventCalls(fetchMock)).toHaveLength(2);
  });
});

describe("ChainCheck (AUD-5)", () => {
  it("says whether the chain is intact and names the first broken entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        json({
          intact: false,
          checked: 2,
          firstBrokenSeq: 3,
          problem: "entry 3 was changed after it was written",
          headSeq: 2,
          headHash: "b".repeat(64),
          verifiedAt: "2026-11-28T01:00:00.000Z",
        }),
      ),
    );
    render(<ChainCheck />);
    await userEvent.click(screen.getByRole("button", { name: "Verify the chain" }));
    expect(await screen.findByText("Chain broken")).toBeInTheDocument();
    expect(
      screen.getByText("First problem at entry 3: entry 3 was changed after it was written."),
    ).toBeInTheDocument();
  });
});

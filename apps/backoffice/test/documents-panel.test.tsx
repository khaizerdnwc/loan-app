import type { CaseDetail, CaseDocumentView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ShellRefresh } from "@/components/app-shell";
import { ActionsPanel } from "@/components/case/actions-panel";
import { DocumentsPanel } from "@/components/case/documents-panel";
import { isOverdue } from "@/lib/info-request";

afterEach(() => vi.unstubAllGlobals());

const REQUESTED: CaseDocumentView = {
  type: "BANK_STATEMENTS_3M",
  status: "REQUESTED",
  requestedAt: "2026-11-28T01:00:00.000Z",
  upload: null,
  review: null,
  actions: ["SIMULATE_UPLOAD"],
};

const RECEIVED: CaseDocumentView = {
  type: "CERTIFICATE_OF_EMPLOYMENT",
  status: "RECEIVED",
  requestedAt: "2026-11-28T01:00:00.000Z",
  upload: {
    reference: "DOC-00000007",
    fileName: "certificate-of-employment.pdf",
    contentType: "application/pdf",
    sizeBytes: 61440,
    pages: 1,
    virusScan: "CLEAN",
    receivedAt: "2026-11-28T02:00:00.000Z",
    providerMode: "SIMULATED",
  },
  review: null,
  actions: ["VERIFY", "REJECT"],
};

function detail(patch: Partial<CaseDetail>): CaseDetail {
  return {
    id: "case-1",
    reference: "APP-1002",
    applicantName: "Joel Reyes",
    status: "INFO_REQUESTED",
    applicant: { fullName: "Joel Reyes" },
    requestedAmount: "200000.00",
    requestedTenorMonths: 36,
    infoRequest: {
      documents: ["BANK_STATEMENTS_3M", "CERTIFICATE_OF_EMPLOYMENT"],
      message: "Hi Joel, please upload your statements.",
      dueOn: "2099-12-31",
      requestedBy: "STF-PAOLO",
      requestedByName: "Paolo Tan",
      requestedAt: "2026-11-28T01:00:00.000Z",
    },
    documents: [REQUESTED, RECEIVED],
    allowedActions: [],
    ...patch,
  } as unknown as CaseDetail;
}

const wrap = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <ShellRefresh.Provider value={vi.fn()}>{ui}</ShellRefresh.Provider>
    </ToastProvider>,
  );

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("isOverdue", () => {
  it("is overdue from the business day after the due date (UTC+8)", () => {
    // 2026-12-01 23:30 in Manila is still the due date; 16:00 UTC on 1 Dec is 00:00 on 2 Dec there.
    expect(isOverdue("2026-12-01", new Date("2026-12-01T15:30:00Z"))).toBe(false);
    expect(isOverdue("2026-12-01", new Date("2026-12-01T16:00:00Z"))).toBe(true);
  });
});

describe("DocumentsPanel (DC-1..DC-3)", () => {
  it("marks an open request whose due date has passed as Overdue, and only while it waits", () => {
    const late = detail({});
    const request = late.infoRequest as NonNullable<CaseDetail["infoRequest"]>;
    const pastDue = { ...late, infoRequest: { ...request, dueOn: "2020-01-03" } };
    const { unmount } = wrap(<DocumentsPanel detail={pastDue} onChanged={vi.fn()} />);
    expect(screen.getByText(/due .*2020/)).toHaveTextContent("Overdue");
    unmount();
    wrap(<DocumentsPanel detail={{ ...pastDue, status: "REVIEW" }} onChanged={vi.fn()} />);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("says so when nothing has been requested", () => {
    wrap(
      <DocumentsPanel detail={detail({ infoRequest: null, documents: [] })} onChanged={vi.fn()} />,
    );
    expect(screen.getByText("No documents requested yet.")).toBeInTheDocument();
  });

  it("row actions are secondary and small; the confirmation keeps the weight", async () => {
    wrap(<DocumentsPanel detail={detail({})} onChanged={vi.fn()} />);
    for (const name of [/^Verify:/, /^Reject:/, /^Simulate borrower upload:/]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-variant", "secondary");
      expect(button).toHaveAttribute("data-size", "sm");
    }
    await userEvent.click(screen.getByRole("button", { name: /^Reject:/ }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Reject" }),
    ).toHaveAttribute("data-variant", "danger");
  });

  it("lists each document with its status, the simulated upload's details and only the API's actions", () => {
    wrap(<DocumentsPanel detail={detail({})} onChanged={vi.fn()} />);
    expect(screen.getByText("Simulated · borrower uploads")).toBeInTheDocument();
    expect(screen.getByText(/Requested by/)).toHaveTextContent("Paolo Tan");
    expect(screen.getByText("“Hi Joel, please upload your statements.”")).toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Document checklist" })).getAllByRole(
      "listitem",
    );
    expect(rows[0]).toHaveTextContent("Bank statements, last 3 months");
    expect(rows[0]).toHaveTextContent("Requested");
    expect(rows[0]).toHaveTextContent("Waiting for the borrower to upload it.");
    expect(
      within(rows[0] as HTMLElement).getByRole("button", {
        name: "Simulate borrower upload: Bank statements, last 3 months",
      }),
    ).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("certificate-of-employment.pdf · 60 KB · 1 page");
    expect(rows[1]).toHaveTextContent("DOC-00000007");
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Verify", "Reject"]);
  });

  it("offers nothing when the API lists no actions (another role)", () => {
    wrap(
      <DocumentsPanel
        detail={detail({ documents: [{ ...RECEIVED, actions: [] }] })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("confirms the simulated upload, posts it and shows the case the API returns", async () => {
    const back = detail({ status: "REVIEW" });
    const fetchMock = vi.fn().mockResolvedValue(json(back));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    wrap(<DocumentsPanel detail={detail({})} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: /Simulate borrower upload/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("The borrower side is simulated");
    expect(dialog).toHaveTextContent("never a file");
    await userEvent.click(within(dialog).getByRole("button", { name: "Simulate borrower upload" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(back));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases/case-1/documents/BANK_STATEMENTS_3M/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      await screen.findByText(/every requested document is in; back to review/),
    ).toBeInTheDocument();
  });

  it("a rejection needs a reason before anything is sent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(detail({})));
    vi.stubGlobal("fetch", fetchMock);
    wrap(<DocumentsPanel detail={detail({})} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Reject:/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(within(dialog).getByText("Enter what is wrong with the document.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("What is wrong with it"), "Unsigned.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/cases/case-1/documents/CERTIFICATE_OF_EMPLOYMENT/review",
        expect.objectContaining({
          body: JSON.stringify({ decision: "REJECTED", reason: "Unsigned." }),
        }),
      ),
    );
  });

  it("a 503 from the upload service keeps the dialog open with the API's words, to try again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json(
          {
            status: 503,
            code: "PROVIDER_UNAVAILABLE",
            detail: "The document upload service is unavailable. Nothing was recorded: try again.",
          },
          503,
        ),
      ),
    );
    wrap(<DocumentsPanel detail={detail({})} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Simulate borrower upload/ }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Simulate borrower upload" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Nothing was recorded: try again.",
    );
  });

  it("a 409 (the case moved on) closes the dialog and shows the case as it is now", async () => {
    const now = detail({ status: "WITHDRAWN", documents: [{ ...REQUESTED, actions: [] }] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            status: 409,
            code: "INVALID_STATE_TRANSITION",
            detail: "The borrower can upload only while information is requested.",
          },
          409,
        ),
      )
      .mockResolvedValueOnce(json(now));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    wrap(<DocumentsPanel detail={detail({})} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole("button", { name: /Simulate borrower upload/ }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Simulate borrower upload" }),
    );
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(now));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Request information in the next-action card (DC-1)", () => {
  it("says what the case waits for while information is requested", () => {
    wrap(<ActionsPanel detail={detail({})} onChanged={vi.fn()} onShowDecision={vi.fn()} />);
    expect(
      screen.getByText(
        /Waiting for the borrower \(simulated\): Bank statements, last 3 months; Certificate of employment\. Due /,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("says since when the request is overdue once the due date has passed", () => {
    const late = detail({});
    const request = late.infoRequest as NonNullable<CaseDetail["infoRequest"]>;
    wrap(
      <ActionsPanel
        detail={{ ...late, infoRequest: { ...request, dueOn: "2020-01-03" } }}
        onChanged={vi.fn()}
        onShowDecision={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Overdue since .*2020: the borrower has not answered by the due date/),
    ).toBeInTheDocument();
  });

  it("asks for at least one document, then sends the request", async () => {
    const asked = detail({});
    const fetchMock = vi.fn().mockResolvedValue(json(asked));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    wrap(
      <ActionsPanel
        detail={detail({
          status: "REVIEW",
          infoRequest: null,
          documents: [{ ...RECEIVED, status: "VERIFIED", actions: [] }],
          allowedActions: [
            {
              action: "REQUEST_INFO",
              enabled: true,
              documentTypes: ["BANK_STATEMENTS_3M", "INCOME_TAX_RETURN"],
            },
            { action: "RECOMMEND", enabled: true },
          ],
        })}
        onChanged={onChanged}
        onShowDecision={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Request information" })).toHaveAttribute(
      "data-variant",
      "secondary",
    );
    await userEvent.click(screen.getByRole("button", { name: "Request information" }));
    const dialog = screen.getByRole("dialog");
    // The dialog offers exactly the types the API listed on the action.
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((b) => b.closest("label")?.textContent),
    ).toEqual(["Bank statements, last 3 months", "Latest income tax return"]);
    await userEvent.click(within(dialog).getByLabelText("Bank statements, last 3 months"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Pick at least one document to request.",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByLabelText("Latest income tax return"));
    await userEvent.selectOptions(within(dialog).getByLabelText("Due"), "5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(asked));
    const [path, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe("/api/cases/case-1/info-request");
    expect(JSON.parse(init.body)).toMatchObject({
      documents: ["INCOME_TAX_RETURN"],
      dueInDays: 5,
    });
  });

  it("shows Recommend disabled with the API's reason while a document waits for review", () => {
    const reason = "Verify or reject the received document first: Certificate of employment.";
    wrap(
      <ActionsPanel
        detail={detail({
          status: "REVIEW",
          allowedActions: [
            {
              action: "RECOMMEND",
              enabled: false,
              blockedBy: "INVALID_STATE_TRANSITION",
              detail: reason,
            },
          ],
        })}
        onChanged={vi.fn()}
        onShowDecision={vi.fn()}
      />,
    );
    const recommend = screen.getByRole("button", { name: "Recommend a decision" });
    expect(recommend).toBeDisabled();
    expect(recommend).toHaveAccessibleDescription(/Verify or reject the received document first/);
  });
});

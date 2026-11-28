import type { CaseExtractionsView, IntakeDraftView, StaffView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import IntakePage from "@/app/(staff)/intake/page";
import { ExtractionsPanel } from "@/components/case/extractions-panel";

const { url, router, session } = vi.hoisted(() => {
  const url = { search: "" };
  return {
    url,
    session: { me: { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" } },
    router: {
      push: (_href: string) => {},
      replace: (href: string) => {
        url.search = href.includes("?") ? href.slice(href.indexOf("?")) : "";
      },
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/intake",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(url.search),
}));
vi.mock("@/lib/session", () => ({ useSession: () => session.me as StaffView }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  url.search = "";
  session.me = { id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" };
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function draft(patch: Partial<IntakeDraftView> & { name: string }): IntakeDraftView {
  const { name, ...rest } = patch;
  return {
    id: `d-${name}`,
    batchReference: "OCR-B-1A2B3C4D",
    source: "PARTNER_SPREADSHEET",
    fileName: "Cordillera Foods HR – salary loan requests Nov 2026.xlsx",
    rowNumber: 2,
    sourceDetail: "Partner spreadsheet, row 2",
    extracted: {
      fullName: name,
      birthDate: "1997-02-14",
      governmentIdLast4: "5521",
      employer: "Cordillera Foods Inc.",
      declaredMonthlyIncome: "32000.00",
      documentMonthlyIncome: null,
      amount: "50000.00",
      tenorMonths: 12,
      purpose: "Tuition",
    },
    matchedApplicant: { id: "APL-X", fullName: name },
    flags: [],
    status: "PENDING_REVIEW",
    providerMode: "SIMULATED",
    uploadedByName: "Paolo Tan",
    uploadedAt: "2026-11-28T01:00:00.000Z",
    case: null,
    review: null,
    actions: ["CONFIRM", "DISCARD"],
    ...rest,
  };
}

const ramil = draft({ name: "Ramil Ocampo" });
const elmer = draft({
  name: "Elmer Santos",
  id: "d-elmer",
  rowNumber: 4,
  sourceDetail: "Partner spreadsheet, row 4",
  matchedApplicant: null,
  flags: ["GOVERNMENT_ID_MISSING"],
});
elmer.extracted = { ...elmer.extracted, governmentIdLast4: null, amount: "70000.00" };
const confirmed = draft({
  name: "Grace Villamor",
  id: "d-grace",
  status: "CONFIRMED",
  actions: [],
  case: { id: "case-9", reference: "APP-1009" },
});

const page = () =>
  render(
    <ToastProvider>
      <IntakePage />
    </ToastProvider>,
  );

describe("Email and file intake screen (INT-5, PRD INT-010)", () => {
  it("lists drafts with their flags, counts To review and All, and links a confirmed draft to its case", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([ramil, elmer, confirmed])),
    );
    const { rerender } = page();
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: /^To review\s*2$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows()).toHaveLength(2);
    expect(
      within(rows()[1] as HTMLElement).getByText("Government ID number missing"),
    ).toBeVisible();
    expect(within(rows()[0] as HTMLElement).getByText("Complete")).toBeVisible();
    expect(within(rows()[0] as HTMLElement).getByText("₱50,000.00 / 12 mo")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^All\s*3$/ }));
    rerender(
      <ToastProvider>
        <IntakePage />
      </ToastProvider>,
    );
    expect(screen.getByRole("link", { name: "APP-1009" })).toHaveAttribute("href", "/cases/case-9");
    expect(screen.getByText(/Simulated/)).toBeVisible();
  });

  it("uploads only after a dialog that says the file and OCR are simulated, then shows what was extracted", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/intake/uploads")) {
        expect(JSON.parse(String(init?.body))).toEqual({ source: "PARTNER_SPREADSHEET" });
        return json(
          {
            reference: "OCR-B-1A2B3C4D",
            source: "PARTNER_SPREADSHEET",
            fileName: "Cordillera Foods HR – salary loan requests Nov 2026.xlsx",
            rowCount: 3,
            flaggedCount: 1,
            providerMode: "SIMULATED",
            drafts: [ramil, elmer],
          },
          201,
        );
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    page();
    await screen.findByText(/No drafts waiting for review/);
    await userEvent.click(screen.getByRole("button", { name: "Upload partner spreadsheet" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Uploads are simulated");
    expect(dialog).toHaveTextContent("No file is stored and no application is created");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Upload partner spreadsheet" }),
    );
    expect(await screen.findByText(/3 rows extracted · 1 needs attention/)).toBeVisible();
  });

  it("shows OCR's refusal in words inside the upload dialog when OCR is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/intake/uploads")
          ? json(
              {
                type: "about:blank",
                title: "Service Unavailable",
                status: 503,
                code: "PROVIDER_UNAVAILABLE",
                detail:
                  "OCR is unavailable. Nothing was recorded: try again, or capture the application by hand in New application.",
              },
              503,
            )
          : json([]),
      ),
    );
    page();
    await screen.findByText(/No drafts waiting for review/);
    await userEvent.click(screen.getByRole("button", { name: "Upload email bundle" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Upload email bundle" }));
    expect(await within(dialog).findByText(/capture the application by hand/)).toBeVisible();
  });

  it("the review dialog asks for the ID OCR could not read, shows the API's field error, then opens the created case", async () => {
    const push = vi.spyOn(router, "push");
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/confirm")) {
          attempts += 1;
          const body = JSON.parse(String(init?.body));
          if (attempts === 1) {
            return json(
              {
                type: "about:blank",
                title: "Bad Request",
                status: 400,
                code: "VALIDATION_FAILED",
                detail: "No customer record matches this draft.",
                errors: [{ field: "governmentIdLast4", message: "No customer on record matches." }],
              },
              400,
            );
          }
          expect(body).toEqual({
            amount: "70000.00",
            tenorMonths: 12,
            purpose: "Tuition",
            governmentIdLast4: "6619",
          });
          return json({
            ...elmer,
            status: "CONFIRMED",
            case: { id: "case-5", reference: "APP-1005" },
          });
        }
        return json([ramil, elmer]);
      }),
    );
    page();
    await userEvent.click(
      await screen.findByRole("button", { name: "Review draft: Elmer Santos" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Creating the draft does not submit it");
    expect(dialog).toHaveTextContent("OCR flagged: Government ID number missing.");
    const id = within(dialog).getByLabelText(/Government ID, last 4 digits/);
    await userEvent.type(id, "1111");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create application draft" }));
    expect(await within(dialog).findByText("No customer on record matches.")).toBeVisible();
    await userEvent.clear(id);
    await userEvent.type(id, "6619");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create application draft" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/cases/case-5"));
  });

  it("a draft no customer matches says to capture the customer first, and a field error with no input in the dialog is shown in its callout", async () => {
    const stranger = draft({
      name: "Marites Dela Paz",
      id: "d-stranger",
      matchedApplicant: null,
      flags: ["NO_CUSTOMER_MATCH"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/confirm")
          ? json(
              {
                type: "about:blank",
                title: "Bad Request",
                status: 400,
                code: "VALIDATION_FAILED",
                detail: "No customer record matches this draft.",
                errors: [
                  {
                    field: "governmentIdLast4",
                    message:
                      "Capture the customer first (New application, New or walk-in customer), then confirm the draft again.",
                  },
                ],
              },
              400,
            )
          : json([stranger]),
      ),
    );
    page();
    await userEvent.click(
      await screen.findByRole("button", { name: "Review draft: Marites Dela Paz" }),
    );
    const dialog = screen.getByRole("dialog");
    // Up front, before any refusal: the next step, naming the walk-in capture.
    expect(dialog).toHaveTextContent("No customer on record matches this draft.");
    expect(dialog).toHaveTextContent("choose New or walk-in customer");
    // The ID was read, so there is no ID input for the API's field error to sit under.
    expect(within(dialog).queryByLabelText(/Government ID, last 4 digits/)).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create application draft" }));
    const alert = await within(dialog).findByText(/No customer record matches this draft\./);
    expect(alert.closest("[role=alert]") ?? alert.parentElement).toHaveTextContent(
      "Capture the customer first (New application, New or walk-in customer)",
    );
  });

  it("discarding asks for a reason before calling the API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/discard")
        ? json({ ...ramil, status: "DISCARDED", actions: [] })
        : json([ramil]),
    );
    vi.stubGlobal("fetch", fetchMock);
    page();
    await userEvent.click(
      await screen.findByRole("button", { name: "Review draft: Ramil Ocampo" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard…" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard draft" }));
    expect(within(dialog).getByText("Enter why this draft is not taken forward.")).toBeVisible();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/discard"))).toBe(false);
    await userEvent.type(
      within(dialog).getByLabelText(/Why is this draft not taken forward/),
      "Duplicate",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Discard draft" }));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/discard"))).toBe(true),
    );
  });

  it("Compliance reads the drafts with no upload or review buttons", async () => {
    session.me = { id: "STF-DIANE", fullName: "Diane Yu", role: "COMPLIANCE" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([{ ...ramil, actions: [] }])),
    );
    page();
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Review draft/ })).toBeNull();
  });
});

const READINGS: CaseExtractionsView = {
  caseId: "case-1",
  lines: [
    {
      documentType: "BANK_STATEMENTS_3M",
      documentStatus: "RECEIVED",
      attempt: 1,
      uploadReference: "DOC-00000001",
      extraction: {
        reference: "OCR-D-AAAA1111",
        documentType: "BANK_STATEMENTS_3M",
        attempt: 1,
        uploadReference: "DOC-00000001",
        providerMode: "SIMULATED",
        monthlyIncome: "50000.00",
        employer: "Luzon Freight Services Inc.",
        statement: {
          salaryCredit: "50000.00",
          monthsWithSalary: 3,
          monthsCovered: 3,
          recurringObligations: "9000.00",
          averageDailyBalance: "30000.00",
          returnedItems: 0,
          riskyMerchants: false,
        },
        compared: {
          monthlyIncome: "65000.00",
          monthlyObligations: "9000.00",
          employer: "Luzon Freight Services Inc.",
        },
        flags: ["INCOME_MISMATCH"],
        extractedByName: "Paolo Tan",
        extractedAt: "2026-11-28T02:00:00.000Z",
      },
      extract: { enabled: false, detail: "Already read." },
    },
    {
      documentType: "CERTIFICATE_OF_EMPLOYMENT",
      documentStatus: "RECEIVED",
      attempt: 1,
      uploadReference: "DOC-00000002",
      extraction: null,
      extract: { enabled: true, detail: null },
    },
    {
      documentType: "INCOME_TAX_RETURN",
      documentStatus: "REQUESTED",
      attempt: 1,
      uploadReference: null,
      extraction: null,
      extract: { enabled: false, detail: "Not received." },
    },
  ],
};

describe("Extracted data (OCR) panel (OCR-1, OCR-2, PRD DOC-002, DOC-007)", () => {
  const panel = (onChanged = vi.fn()) =>
    render(
      <ToastProvider>
        <ExtractionsPanel caseId="case-1" version={0} onChanged={onChanged} />
      </ToastProvider>,
    );

  it("shows the statement analysis and the mismatch in pesos against the application, labelled simulated; documents not received are left out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(READINGS)),
    );
    panel();
    expect(await screen.findByText("Bank statement analysis")).toBeVisible();
    expect(screen.getByText("₱50,000.00 monthly, 3 of 3 months")).toBeVisible();
    expect(screen.getByText("None detected")).toBeVisible();
    expect(
      screen.getByText(
        /Income differs from the declared figure: ₱50,000.00 read, ₱65,000.00 on the application/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Simulated/)).toBeVisible();
    expect(screen.queryByText("Latest income tax return")).toBeNull();
  });

  it("reads a document only after a dialog that says OCR does not change the decision, then refreshes the history", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/extract") ? json(READINGS) : json(READINGS),
    );
    vi.stubGlobal("fetch", fetchMock);
    panel(onChanged);
    await userEvent.click(
      await screen.findByRole("button", { name: "Read with OCR: Certificate of employment" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("it does not change the decision");
    await userEvent.click(within(dialog).getByRole("button", { name: "Read with OCR" }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cases/case-1/documents/CERTIFICATE_OF_EMPLOYMENT/extract",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("a refusal because the document moved on closes the dialog and re-reads the panel", async () => {
    let gets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/extract")) {
          return json(
            {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              code: "INVALID_STATE_TRANSITION",
              detail: "Certificate of employment has already been read with OCR.",
            },
            409,
          );
        }
        gets += 1;
        return json(READINGS);
      }),
    );
    panel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Read with OCR: Certificate of employment" }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Read with OCR" }),
    );
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(gets).toBe(2);
  });
});

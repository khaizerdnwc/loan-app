import type { ApplicantView } from "@loan/core";
import { ToastProvider } from "@loan/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import NewApplicationPage from "@/app/(staff)/cases/new/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/cases/new",
}));
vi.mock("@/lib/session", () => ({
  useSession: () => ({ id: "STF-PAOLO", fullName: "Paolo Tan", role: "LOAN_OFFICER" }),
}));

afterEach(() => vi.unstubAllGlobals());

const applicant = (id: string, fullName: string): ApplicantView => ({
  id,
  fullName,
  birthDate: "1990-01-01",
  ageYears: 36,
  employer: "Synthetic Co.",
  employmentMonths: 24,
  relationshipMonths: 0,
  monthlyIncome: "50000.00",
  monthlyObligations: "5000.00",
  depositAccount: "",
  governmentIdMasked: "•••• •••• 1234",
});

const MARIA = applicant("APL-MARIA", "Maria Santos");
const CELESTE = applicant("APL-W00000000C1", "Celeste Navarro");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/**
 * WI-1 bug (e2e at merge): after "Add applicant" the dialog closed but the Applicant select
 * stayed on "Choose an applicant", because the new id was set before the refetched list had
 * rendered its option, so the select had nothing to select.
 */
function serveApi(onFile: ApplicantView[], created: ApplicantView, lookupOnFile = false) {
  let list = onFile;
  return vi.fn(async (url: string, init?: { method?: string }) => {
    if (url === "/api/applicants" && init?.method === "POST") {
      list = [...list, created];
      return json(created, 201);
    }
    if (url === "/api/applicants") {
      const now = json(list);
      // An applicant already on file was captured elsewhere: later reads include them.
      if (lookupOnFile && !list.includes(created)) list = [...list, created];
      return now;
    }
    if (url.startsWith("/api/customers/")) {
      return json({
        customerNumber: "CIF-100412",
        fullName: created.fullName,
        birthDate: "1997-07-25",
        governmentIdLast4: "8814",
        employer: "Quezon City Public Library",
        employmentMonths: 20,
        monthlyIncome: "38000.00",
        monthlyObligations: "3000.00",
        relationshipMonths: 14,
        depositAccount: "WB-SAV-0412-6045",
        providerMode: "SIMULATED",
        applicantId: lookupOnFile ? created.id : null,
      });
    }
    return json({});
  });
}

const renderPage = () =>
  render(
    <ToastProvider>
      <NewApplicationPage />
    </ToastProvider>,
  );

const applicantSelect = () => screen.getByLabelText("Applicant", { selector: "select" });

describe("New application: a newly captured applicant is selected (WI-1)", () => {
  it("a blank months-with-employer field is sent as nothing, never 0, and the API's officer wording shows under it without the field token", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        if (url === "/api/applicants" && init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return json(
            {
              type: "about:blank",
              title: "Bad Request",
              status: 400,
              code: "VALIDATION_FAILED",
              detail: "Check the highlighted fields.",
              errors: [
                {
                  field: "employmentMonths",
                  message:
                    "employmentMonths Enter the months with the employer as a whole number, 0 to 600.",
                },
              ],
            },
            400,
          );
        }
        return json([MARIA]);
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New or walk-in customer" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "New to the bank" }));
    await userEvent.type(within(dialog).getByLabelText("Full name"), "Rogelio Santiago");
    await userEvent.type(within(dialog).getByLabelText("Birth date"), "1990-02-03");
    await userEvent.type(within(dialog).getByLabelText(/Government ID/), "1234");
    await userEvent.type(within(dialog).getByLabelText("Employer"), "Synthetic Co.");
    await userEvent.type(within(dialog).getByLabelText(/income/i), "30000");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add applicant" }));
    expect(
      await within(dialog).findByText(
        "Enter the months with the employer as a whole number, 0 to 600.",
      ),
    ).toBeVisible();
    expect(posted[0]).not.toHaveProperty("employmentMonths");
  });

  it("selects the applicant just added from core, by id and by name", async () => {
    vi.stubGlobal("fetch", serveApi([MARIA], CELESTE));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New or walk-in customer" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Customer number"), "CIF-100412");
    await userEvent.click(within(dialog).getByRole("button", { name: "Find in core" }));
    await within(dialog).findByTestId("core-customer");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add applicant" }));

    await vi.waitFor(() => expect(applicantSelect()).toHaveValue(CELESTE.id));
    const select = applicantSelect() as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toContain("Celeste Navarro");
  });

  it("selects a customer already on file when the officer chooses them", async () => {
    vi.stubGlobal("fetch", serveApi([MARIA], CELESTE, true));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New or walk-in customer" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Customer number"), "CIF-100412");
    await userEvent.click(within(dialog).getByRole("button", { name: "Find in core" }));
    // On file since the page loaded (captured elsewhere): not yet in the page's list.
    await userEvent.click(await within(dialog).findByRole("button", { name: "Choose them" }));
    await vi.waitFor(() => expect(applicantSelect()).toHaveValue(CELESTE.id));
  });

  /** Find CIF-100412 (on file, not in the page's list) and choose them. */
  async function chooseOnFile() {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "New or walk-in customer" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Customer number"), "CIF-100412");
    await userEvent.click(within(dialog).getByRole("button", { name: "Find in core" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Choose them" }));
  }

  it.each([
    ["fails", () => new Response("{}", { status: 502 })],
    ["comes back without them", () => json([MARIA])],
  ])(
    "when the refresh %s, nothing is selected, the officer is told, and a later refresh does not select behind their back",
    async (label, refresh) => {
      let reads = 0;
      const ROGELIO = applicant("APL-W00000000R1", "Rogelio Santiago");
      const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
        if (url === "/api/applicants" && init?.method === "POST") return json(ROGELIO, 201);
        if (url === "/api/applicants") {
          reads += 1;
          if (reads === 1) return json([MARIA]);
          if (reads === 2) return refresh();
          return json([MARIA, CELESTE, ROGELIO]);
        }
        if (url.startsWith("/api/customers/")) {
          return json({
            customerNumber: "CIF-100412",
            fullName: "Celeste Navarro",
            employer: "Quezon City Public Library",
            employmentMonths: 20,
            monthlyIncome: "38000.00",
            monthlyObligations: "3000.00",
            relationshipMonths: 14,
            depositAccount: "WB-SAV-0412-6045",
            providerMode: "SIMULATED",
            applicantId: CELESTE.id,
          });
        }
        return json({});
      });
      vi.stubGlobal("fetch", fetchMock);
      await chooseOnFile();
      expect(
        await screen.findByText(
          "Could not load Celeste Navarro into the list; try again or reload the page.",
        ),
      ).toBeInTheDocument();
      expect(applicantSelect()).toHaveValue("");

      if (label === "fails") {
        // The list's own "Try again" brings Celeste in: she is listed, not selected.
        await userEvent.click(screen.getByRole("button", { name: "Try again" }));
        await vi.waitFor(() =>
          expect(screen.getAllByRole("option").map((o) => o.textContent)).toContainEqual(
            expect.stringContaining("Celeste Navarro"),
          ),
        );
        expect(applicantSelect()).toHaveValue("");
        return;
      }

      // A later refresh that does bring Celeste in (after adding a walk-in) selects the walk-in
      // the officer just added, never the abandoned Celeste.
      await userEvent.click(screen.getByRole("button", { name: "New or walk-in customer" }));
      const dialog = screen.getByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "New to the bank" }));
      await userEvent.type(within(dialog).getByLabelText("Full name"), "Rogelio Santiago");
      await userEvent.type(within(dialog).getByLabelText("Birth date"), "1988-06-12");
      await userEvent.type(within(dialog).getByLabelText("Government ID (last 4 digits)"), "4410");
      await userEvent.type(
        within(dialog).getByLabelText("Employer", { exact: true }),
        "Bulacan Hardware",
      );
      await userEvent.type(within(dialog).getByLabelText("Monthly income (pesos)"), "52000");
      await userEvent.click(within(dialog).getByRole("button", { name: "Add applicant" }));
      await vi.waitFor(() => expect(reads).toBe(3));
      await vi.waitFor(() =>
        expect(screen.getAllByRole("option").map((o) => o.textContent)).toContainEqual(
          expect.stringContaining("Celeste Navarro"),
        ),
      );
      expect(applicantSelect()).toHaveValue(ROGELIO.id);
    },
  );

  it("the officer's own choice wins over a selection still waiting for the list", async () => {
    let release: (r: Response) => void = () => {};
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/applicants") {
          reads += 1;
          if (reads === 1) return json([MARIA]);
          return new Promise<Response>((r) => (release = r));
        }
        if (url.startsWith("/api/customers/")) {
          return json({
            customerNumber: "CIF-100412",
            fullName: "Celeste Navarro",
            depositAccount: "WB-SAV-0412-6045",
            relationshipMonths: 14,
            monthlyIncome: "38000.00",
            providerMode: "SIMULATED",
            applicantId: CELESTE.id,
          });
        }
        return json({});
      }),
    );
    await chooseOnFile();
    await userEvent.selectOptions(applicantSelect(), MARIA.id);
    release(json([MARIA, CELESTE]));
    await vi.waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toContainEqual(
        expect.stringContaining("Celeste Navarro"),
      ),
    );
    expect(applicantSelect()).toHaveValue(MARIA.id);
  });
});

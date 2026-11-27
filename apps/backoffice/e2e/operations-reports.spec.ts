import { expect, test } from "@playwright/test";
import {
  act,
  caseHeader,
  dialog,
  openCase,
  resetModes,
  setMode,
  signIn,
  submitApplication,
} from "./support";

/**
 * Booking exceptions and reconciliation (ACCEPTANCE REC-1, REC-2, REC-5) and the reports
 * (RPT-1, RPT-2, RPT-4) in the browser. Hernan Salazar is this file's own applicant.
 */
test.afterEach(async ({ page }) => {
  await resetModes(page);
});

test("REC-1/REC-2/REC-5 a lost reply leaves a failed booking; loan operations reconciles and finds the open core account", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-HERNAN", "90000", "12");
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  const current = page
    .getByRole("navigation", { name: "Breadcrumb" })
    .locator('[aria-current="page"]');
  await expect(current).toHaveText(/^APP-\d+$/);
  const reference = (await current.textContent())?.trim() ?? "";

  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(page.getByRole("button", { name: "Submit booking for checker" })).toBeVisible();
  await act(page, "Submit booking for checker");

  // Core opens the account, then its reply is lost: the booking fails, nothing is recorded.
  await setMode(page, "Core banking (simulated)", "LOST_REPLY");
  await openCase(page, "ella", path);
  await act(page, "Approve booking");
  await expect(dialog(page).getByRole("alert")).toContainText(/did not answer in time/);
  await expect(caseHeader(page)).toContainText("Booking failed");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await setMode(page, "Core banking (simulated)", "OK");

  // REC-1: the exception is listed with its key and error.
  await signIn(page, "ella");
  await page.getByRole("link", { name: "Booking exceptions" }).click();
  await expect(page.getByRole("heading", { name: "Booking exceptions", level: 1 })).toBeVisible();
  const row = page
    .getByRole("table", { name: "Booking exceptions" })
    .getByRole("row")
    .filter({ hasText: "Hernan Salazar" });
  await expect(row).toContainText(reference);
  await expect(row).toContainText(/bk-/);
  await expect(row).toContainText(/did not answer in time/);
  await expect(row).toContainText("Can retry");

  // REC-2/REC-5: the run finds core's open, undisbursed account for this case.
  await page.getByRole("button", { name: "Run reconciliation" }).click();
  const findings = page.getByRole("table", { name: "Reconciliation findings" });
  const finding = findings.getByRole("row").filter({ hasText: reference });
  await expect(finding).toContainText("Open in core, not disbursed");
  await expect(finding).toContainText("Core: ₱90,000.00");
  await expect(finding).toContainText("Lending: none");
  await expect(page.getByText(/Last run .* by Ella Reyes/)).toBeVisible();
  await expect(row).toContainText("Open in core, not disbursed");

  // Compliance reads the same screen but cannot run a reconciliation.
  await signIn(page, "diane");
  await page.getByRole("link", { name: "Booking exceptions" }).click();
  await expect(
    page.getByRole("table", { name: "Booking exceptions" }).getByRole("row").filter({
      hasText: "Hernan Salazar",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run reconciliation" })).toHaveCount(0);
  await expect(page.getByText("Loan operations runs the reconciliation.")).toBeVisible();
});

test("RPT-1/RPT-2/RPT-4 the reports show counts for a period; Compliance reads them; loan operations does not", async ({
  page,
}) => {
  await signIn(page, "rina");
  await page.getByRole("link", { name: "Decisioning" }).click();
  await expect(page.getByRole("heading", { name: "Decisioning", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "7 days" }).click();
  await expect(page.getByRole("button", { name: "7 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Straight-through rate")).toBeVisible();
  await expect(page.getByText("Decisions", { exact: true }).locator("..")).toContainText(/\d/);
  await expect(page.getByRole("list", { name: "Decision mix" })).toContainText("Auto-approve");

  await signIn(page, "diane");
  await page.getByRole("link", { name: "Origination funnel" }).click();
  await expect(page.getByRole("heading", { name: "Origination funnel", level: 1 })).toBeVisible();
  const funnel = page.getByRole("list", { name: "Funnel" });
  await expect(funnel).toContainText("Started");
  await expect(funnel).toContainText("Disbursed");
  await expect(page.getByText(/of approved · ₱/)).toBeVisible();

  // Loan operations has no Reports group, and the API refuses the report if asked directly.
  await signIn(page, "marco");
  await expect(page.getByRole("link", { name: "Origination funnel" })).toHaveCount(0);
  await page.goto("/reports/funnel");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your role cannot do this." }),
  ).toBeVisible();
});

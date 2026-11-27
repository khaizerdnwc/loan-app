import { expect, type Page, test } from "@playwright/test";
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
 * IR-1 and BK-1 in the browser. Teresa (Maria's profile) and Paz (the same profile, but her
 * account is at another bank) are used by no other journey: one open application per
 * applicant (INT-007).
 */
test.afterEach(async ({ page }) => {
  await resetModes(page);
});

const indicative = (page: Page) => page.getByTestId("indicative-repayment");

const checklist = (page: Page) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: "Pre-booking checklist" }),
  });

async function fillTerms(page: Page, applicantId: string, amount: string, tenor: string) {
  await signIn(page, "paolo");
  await page.goto("/cases/new");
  await page.getByLabel("Applicant", { exact: true }).selectOption(applicantId);
  await page.getByLabel("Amount (pesos)").fill(amount);
  await page.getByLabel("Tenor (months)").fill(tenor);
}

test("IR-1 new application shows core's indicative repayment at grade C, then the booking checklist passes (BK-1)", async ({
  page,
}) => {
  await fillTerms(page, "APL-TERESA", "150000", "24");
  // 150,000 × 1.60% × 24 = 57,600; 207,600 ÷ 24.
  await expect(indicative(page)).toContainText("Indicative monthly repayment₱8,650.00");
  await expect(indicative(page)).toContainText("At grade C pricing");
  await expect(indicative(page)).toContainText("calculated by core");
  await expect(indicative(page)).toContainText("Simulated");
  // Invalid terms: nothing is quoted.
  await page.getByLabel("Tenor (months)").fill("48");
  await expect(indicative(page)).toContainText("Shown once the amount and tenor are valid");

  const path = await submitApplication(page, "APL-TERESA", "150000", "24");
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  await openCase(page, "marco", path);
  await expect(checklist(page)).toHaveCount(0);
  await act(page, "Record borrower e-signature");
  await expect(caseHeader(page)).toContainText("Ready to book");

  await expect(checklist(page)).toContainText("Every item passes");
  for (const item of [
    "Approvals complete",
    "Documents signed",
    "KYC valid",
    "Disbursement account verified",
  ]) {
    await expect(checklist(page).getByRole("listitem").filter({ hasText: item })).toContainText(
      "passes",
    );
  }
  await act(page, "Submit booking for checker");
  await expect(caseHeader(page)).toContainText("Awaiting checker");
});

test("IR-1 with core banking down, the indicative repayment says unavailable and the form still works", async ({
  page,
}) => {
  await setMode(page, "Core banking (simulated)", "OUTAGE");
  await fillTerms(page, "APL-PAZ", "150000", "24");
  await expect(indicative(page)).toContainText("Indicative monthly repaymentUnavailable");
  await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Submit for decision" })).toBeEnabled();
});

test("BK-1 a failing checklist item disables Submit booking, with the item as the reason", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-PAZ", "60000", "12");
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(caseHeader(page)).toContainText("Ready to book");

  await expect(checklist(page)).toContainText("3 of 4 pass");
  await expect(
    checklist(page).getByRole("listitem").filter({ hasText: "Disbursement account verified" }),
  ).toContainText("fails");
  const submit = page.getByRole("button", { name: "Submit booking for checker" });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(
    /Pre-booking checklist: Disbursement account verified — No valid WhiteBank deposit account/,
  );
  await expect(dialog(page)).toHaveCount(0);
});

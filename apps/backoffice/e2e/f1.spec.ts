import { expect, test } from "@playwright/test";
import { act, caseHeader, dialog, history, openCase, submitApplication } from "./support";

/**
 * F1 — auto-approved loan, end to end in the browser (ACCEPTANCE F1-1..F1-5): Maria Santos,
 * ₱150,000 over 24 months.
 */
test("F1 Maria is auto-approved, signed, booked by a different checker and disbursed", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-MARIA", "150000", "24");

  // F1-1/F1-2: the decision, its score and grade are shown.
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  await expect(page.locator('[aria-label="Grade A"]')).toBeVisible();
  await expect(page.locator('[aria-label^="Score 742 "]')).toBeVisible();
  // D-16: the engine's affordable amount, capped at the amount asked, through formatPeso.
  await expect(
    page.getByText("Affordable amount (engine)", { exact: true }).locator(".."),
  ).toContainText("₱150,000.00");

  // The stored decision record reproduces to the same result.
  await page.getByRole("button", { name: "Decision record", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Reproduce" }).click();
  await expect(dialog(page).getByRole("status")).toContainText("Match");
  await dialog(page).getByRole("button", { name: "Close" }).click();

  // F1-3: loan operations records the (simulated) signature and submits the booking.
  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(page.getByRole("button", { name: "Submit booking for checker" })).toBeVisible();
  await act(page, "Submit booking for checker");
  await expect(page.getByText(/Waiting for a loan operations supervisor/)).toBeVisible();
  // The maker has no way to check their own booking.
  await expect(page.getByRole("button", { name: "Approve booking" })).toHaveCount(0);

  // F1-4/F1-5: a supervisor approves; the account, schedule and disbursement appear.
  await openCase(page, "ella", path);
  await act(page, "Approve booking");
  await expect(caseHeader(page)).toContainText("Disbursed");
  const schedule = page.getByRole("table", { name: "Repayment schedule" });
  await expect(schedule.locator("tbody tr")).toHaveCount(24);
  await expect(page.getByText("Reconciled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Disbursed ₱150,000\.00/)).toBeVisible();

  await expect(history(page)).toContainText("Ella Reyes");
  await expect(history(page)).toContainText("Marco Bautista");
  await expect(history(page)).toContainText("Paolo Tan");
});

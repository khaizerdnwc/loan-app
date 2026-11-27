import { expect, test } from "@playwright/test";
import {
  act,
  caseHeader,
  dialog,
  history,
  openCase,
  resetModes,
  setMode,
  submitApplication,
} from "./support";

/**
 * Failure handling driven from the simulation screen (ACCEPTANCE B-7, B-5). Every test puts
 * the simulated services back to normal afterwards, so the journeys stay independent.
 */
test.afterEach(async ({ page }) => {
  await resetModes(page);
});

test("B-7 with the bureau in outage, an application is referred, never declined", async ({
  page,
}) => {
  await setMode(page, "Credit bureau (simulated)", "OUTAGE");
  await expect(
    page.getByRole("status").filter({ hasText: "Simulated failure active" }),
  ).toContainText("Credit bureau");

  await submitApplication(page, "APL-MARIA", "60000", "12");
  await expect(page.getByText("Referred to human review.")).toBeVisible();
  await expect(page.getByText(/Credit bureau unavailable/).first()).toBeVisible();
  await expect(page.getByText(/Not scored/)).toBeVisible();
  await expect(caseHeader(page)).toContainText("In review");
});

test("B-5 a core banking timeout fails the booking; a retry with the same key books once", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-MARIA", "150000", "24");
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(page.getByRole("button", { name: "Submit booking for checker" })).toBeVisible();
  await act(page, "Submit booking for checker");
  await expect(page.getByText(/Waiting for a loan operations supervisor/)).toBeVisible();

  await setMode(page, "Core banking (simulated)", "TIMEOUT");

  await openCase(page, "ella", path);
  await act(page, "Approve booking");
  await expect(dialog(page).getByRole("alert")).toContainText(/did not answer in time/);
  // No reload: the panel re-reads the case while the refusal stays in the dialog, which now
  // offers the retry under its own name.
  await expect(caseHeader(page)).toContainText("Booking failed");
  await expect(dialog(page).getByRole("button", { name: "Retry booking" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await setMode(page, "Core banking (simulated)", "OK");

  await openCase(page, "lito", path);
  await act(page, "Retry booking");
  await expect(caseHeader(page)).toContainText("Disbursed");
  await expect(
    page.getByRole("table", { name: "Repayment schedule" }).locator("tbody tr"),
  ).toHaveCount(24);
  await expect(history(page)).toContainText(/failed/);
  await expect(history(page)).toContainText("Lito Garcia");
});

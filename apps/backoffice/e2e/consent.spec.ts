import { expect, test } from "@playwright/test";
import { signIn } from "./support";

/**
 * C-1 in the browser: no consent, no submission; the case then shows who recorded it. Uses Ana
 * (Maria's twin profile) so it never shares an applicant with F1: one open application each.
 */
test("C-1 submitting needs both consents; the case shows who captured them", async ({ page }) => {
  await signIn(page, "paolo");
  await page.goto("/cases/new");
  await page.getByLabel("Applicant", { exact: true }).selectOption("APL-ANA");
  await page.getByLabel("Amount (pesos)").fill("60000");
  await page.getByLabel("Tenor (months)").fill("12");
  await page.getByLabel("Purpose").fill("Home improvement");
  await page.getByLabel("Credit bureau check").check();
  await page.getByRole("button", { name: "Submit for decision" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Record both consents" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByLabel("Data processing under the Data Privacy Act").check();
  await page.getByRole("button", { name: "Submit for decision" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/Recorded the applicant's consent/).first()).toBeVisible();
  await expect(page.getByText(/Captured by Paolo Tan at the branch/)).toBeVisible();
});

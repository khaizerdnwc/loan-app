import { expect, test } from "@playwright/test";
import { caseHeader, dialog, history, signIn } from "./support";

/**
 * W-1 in the browser: the loan officer withdraws a draft with a reason; the case shows the
 * Withdrawn pill, who withdrew it and why. Uses Rosa (Maria's twin profile), whom no other
 * journey uses: one open application per applicant (INT-007).
 */
test("W-1 the loan officer withdraws a draft with a reason", async ({ page }) => {
  await signIn(page, "paolo");
  await page.goto("/cases/new");
  await page.getByLabel("Applicant", { exact: true }).selectOption("APL-ROSA");
  await page.getByLabel("Amount (pesos)").fill("60000");
  await page.getByLabel("Tenor (months)").fill("12");
  await page.getByLabel("Purpose").fill("Home improvement");
  await page.getByRole("button", { name: "Save draft" }).click();
  await dialog(page).getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  await expect(caseHeader(page).getByText("Draft", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Withdraw application" }).click();
  await expect(dialog(page)).toContainText("Withdraw this application?");
  // A reason is required before anything is sent.
  await dialog(page).getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(dialog(page).getByText("Choose a reason.")).toBeVisible();
  await dialog(page).getByLabel("Reason").selectOption("APPLICANT_REQUEST");
  await dialog(page).getByLabel("Note (optional)").fill("Found a cheaper loan elsewhere.");
  await dialog(page).getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(dialog(page)).toBeHidden();

  await expect(caseHeader(page).getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Withdrawn: closed by Paolo Tan \(Applicant withdrew\)/),
  ).toBeVisible();
  const card = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Withdrawal" }),
  });
  await expect(card).toContainText("Applicant withdrew");
  await expect(card).toContainText("Paolo Tan");
  await expect(card).toContainText("Found a cheaper loan elsewhere.");
  await expect(page.getByRole("button", { name: "Withdraw application" })).toHaveCount(0);
  await expect(history(page)).toContainText(/Withdrew the application: Applicant withdrew/);
});

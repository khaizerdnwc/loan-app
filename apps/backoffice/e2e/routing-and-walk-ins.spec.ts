import { expect, type Page, test } from "@playwright/test";
import { act, caseHeader, dialog, history, signIn } from "./support";

/**
 * WI-1 and QR-1 in the browser: a walk-in new to the bank is captured by hand and applies; the
 * referral lands unassigned in the team queue; Paolo picks it, hands it to Joy with a reason
 * and marks it high priority; Joy finds it under Mine. A second journey pre-fills an existing
 * customer from simulated core. The applicants are created here, so no seeded persona is used.
 */
async function newApplication(page: Page) {
  await signIn(page, "paolo");
  await page.goto("/cases/new");
  await page.getByRole("button", { name: "New or walk-in customer" }).click();
  await expect(dialog(page)).toContainText("New or walk-in customer");
}

async function applyFor(page: Page, amount: string, tenor: string) {
  await page.getByLabel("Amount (pesos)").fill(amount);
  await page.getByLabel("Tenor (months)").fill(tenor);
  await page.getByLabel("Purpose").fill("Store renovation");
  await page.getByLabel("Credit bureau check").check();
  await page.getByLabel("Data processing under the Data Privacy Act").check();
  await page.getByRole("button", { name: "Submit for decision" }).click();
  await dialog(page).getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
}

test("WI-1 and QR-1 a walk-in is captured by hand, referred to the team queue, picked, reassigned and prioritised", async ({
  page,
}) => {
  await newApplication(page);
  await dialog(page).getByRole("button", { name: "New to the bank" }).click();
  await dialog(page).getByLabel("Full name").fill("Rogelio Santiago");
  await dialog(page).getByLabel("Birth date").fill("1988-06-12");
  await dialog(page).getByLabel("Government ID (last 4 digits)").fill("4410");
  await dialog(page).getByLabel("Employer").fill("Bulacan Hardware Trading");
  await dialog(page).getByLabel("Months with employer").fill("36");
  await dialog(page).getByLabel("Monthly income (pesos)").fill("52000");
  await dialog(page).getByLabel("Monthly obligations (pesos)").fill("6000");
  await dialog(page).getByRole("button", { name: "Add applicant" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByLabel("Applicant", { exact: true })).toHaveValue(/^APL-W/);

  await applyFor(page, "60000", "12");
  // New to the bank: no bureau file in the simulator, so the case is referred, never declined.
  await expect(caseHeader(page)).toContainText("In review");
  await expect(page.getByTestId("case-owner")).toContainText("Unassigned · Branch");

  await act(page, "Pick this case");
  await expect(page.getByTestId("case-owner")).toContainText("Owner Paolo Tan");

  await page.getByRole("button", { name: "Reassign" }).click();
  await dialog(page).getByLabel("New owner").selectOption("STF-JOY");
  await dialog(page).getByLabel("Reason").fill("Paolo is on leave from Monday.");
  await dialog(page).getByRole("button", { name: "Reassign" }).click();
  await expect(page.getByTestId("case-owner")).toContainText("Owner Joy Dela Cruz");

  await page.getByRole("button", { name: "Change priority" }).click();
  await dialog(page).getByRole("button", { name: "Mark high priority" }).click();
  await expect(caseHeader(page).getByText("High priority")).toBeVisible();
  await expect(history(page)).toContainText(/Reassigned to Joy Dela Cruz: Paolo is on leave/);
  const path = new URL(page.url()).pathname;

  await signIn(page, "joy");
  await page.goto("/queue");
  await page.getByRole("button", { name: /^Mine/ }).click();
  const row = page.getByRole("row").filter({ hasText: "Rogelio Santiago" });
  await expect(row).toContainText("Joy Dela Cruz");
  await expect(row).toContainText("High priority");
  await row.getByRole("link", { name: "Rogelio Santiago" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
});

test("WI-1 an existing customer is pre-filled from simulated core banking", async ({ page }) => {
  await newApplication(page);
  await dialog(page).getByLabel("Customer number").fill("CIF-100412");
  await dialog(page).getByRole("button", { name: "Find in core" }).click();
  const found = dialog(page).getByTestId("core-customer");
  await expect(found).toContainText("Celeste Navarro");
  await expect(found).toContainText("Simulated");
  await expect(found).toContainText("WB-SAV-0412-6045");
  await dialog(page).getByRole("button", { name: "Add applicant" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(
    page.getByLabel("Applicant", { exact: true }).locator("option:checked"),
  ).toContainText("Celeste Navarro");
});

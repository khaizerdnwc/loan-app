import { expect, test } from "@playwright/test";
import { act, caseHeader, dialog, history, signIn } from "./support";

/**
 * INT-6, INT-8, INT-9 in the browser (PRD INT-010, INT-005): the loan officer uploads the
 * Makati Logistics spreadsheet (synthetic, simulated OCR), whose people are not on record, and
 * confirms Marites Dela Paz's draft by capturing her as a new applicant in the same step. The
 * case comes in on the File intake channel and is submitted after consent like any application.
 * Marites is in no seed and no other journey: she exists only once this journey captures her.
 */
test.beforeEach(async ({ page }) => {
  // A retry must not find the file's drafts from a failed first attempt still waiting.
  await signIn(page, "paolo");
  const statuses = await page.evaluate(async () => {
    const res = await fetch("/api/intake/drafts?view=pending");
    const drafts = (await res.json()) as { id: string; fileName: string }[];
    const out: number[] = [];
    for (const d of drafts.filter((x) => x.fileName.startsWith("Makati Logistics"))) {
      const r = await fetch(`/api/intake/drafts/${d.id}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Journey retry: left over from an earlier attempt" }),
      });
      out.push(r.status);
    }
    return out;
  });
  expect(statuses.every((s) => s === 200)).toBe(true);
});

test("INT-6, INT-8, INT-9 a draft for someone not on record: the customer is captured with the draft, on the File intake channel", async ({
  page,
}) => {
  await signIn(page, "paolo");
  await page.goto("/intake");
  await page.getByRole("button", { name: "Upload partner spreadsheet" }).click();
  await dialog(page).getByLabel("Synthetic file").selectOption("MAKATI_LOGISTICS");
  await dialog(page).getByRole("button", { name: "Upload partner spreadsheet" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(/2 rows extracted · 2 need attention/)).toBeVisible();

  const rodel = page.getByRole("row").filter({ hasText: "Rodel Pascual" });
  await expect(rodel).toContainText("Amount or tenor outside the product");
  const row = page.getByRole("row").filter({ hasText: "Marites Dela Paz" });
  await expect(row).toContainText("No customer record matches");
  await row.getByRole("button", { name: "Review draft: Marites Dela Paz" }).click();
  await expect(dialog(page)).toContainText("also captures them as a new applicant");
  await dialog(page).getByLabel("Months with employer").fill("30");
  await dialog(page).getByLabel("Monthly obligations (pesos)").fill("4000");
  await dialog(page).getByRole("button", { name: "Capture customer and create draft" }).click();

  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  await expect(caseHeader(page)).toContainText("Marites Dela Paz");
  await expect(caseHeader(page)).toContainText("Draft");
  await expect(page.getByText(/File intake/).first()).toBeVisible();
  await expect(history(page)).toContainText(/Captured from intake batch OCR-B-/);

  await page.getByLabel("The applicant consents to a credit bureau check").check();
  await page
    .getByLabel("The applicant consents to data processing under the Data Privacy Act")
    .check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByText(/Captured by Paolo Tan at the branch/)).toBeVisible();
  await act(page, "Submit for decision");
  // New to the bank: no bureau file in the simulator, so referred, never declined.
  await expect(page.getByText("Referred to human review.")).toBeVisible();

  await page.goto("/intake?view=all");
  await expect(page.getByRole("row").filter({ hasText: "Marites Dela Paz" })).toContainText(
    "Customer captured from the draft",
  );
});

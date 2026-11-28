import { expect, type Page, test } from "@playwright/test";
import { act, caseHeader, dialog, history, signIn } from "./support";

/**
 * INT-1, INT-3, OCR-1 in the browser (PRD INT-010, DOC-002, DOC-007, F4): the loan officer
 * uploads an email bundle (synthetic, simulated OCR), reviews the extracted draft and creates
 * an application draft from it — nothing is submitted until consent is recorded and the
 * officer submits it. Referred, the borrower's statements are requested, uploaded (simulated)
 * and read with OCR into a bank statement analysis. Uses Grace Villamor (Joel's thin-file
 * profile), the email bundle's applicant, whom no other journey uses.
 */
const extracted = (page: Page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Extracted data (OCR)" }) });

/**
 * A retry (CI retries once) must not find the email bundle's draft from a failed first attempt
 * still waiting for review, which would refuse the upload: discard any pending one, as Paolo,
 * through the API. (An open case left by a failed attempt is the known limit of every journey.)
 */
test.beforeEach(async ({ page }) => {
  await signIn(page, "paolo");
  const statuses = await page.evaluate(async () => {
    const res = await fetch("/api/intake/drafts?view=pending");
    const drafts = (await res.json()) as { id: string; source: string }[];
    const out: number[] = [];
    for (const d of drafts.filter((x) => x.source === "EMAIL_BUNDLE")) {
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

test("INT-1, INT-3, OCR-1 email bundle to a reviewed draft, submitted, statements analysed by OCR", async ({
  page,
}) => {
  await signIn(page, "paolo");
  await page.goto("/intake");
  await expect(page.getByRole("heading", { name: "Email and file intake" })).toBeVisible();

  await page.getByRole("button", { name: "Upload email bundle" }).click();
  await expect(dialog(page)).toContainText("Uploads are simulated");
  await dialog(page).getByRole("button", { name: "Upload email bundle" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(/1 row extracted · 0 need attention/)).toBeVisible();

  const row = page.getByRole("row").filter({ hasText: "Grace Villamor" });
  await expect(row).toContainText("Complete");
  await row.getByRole("button", { name: "Review draft: Grace Villamor" }).click();
  await expect(dialog(page)).toContainText("Creating the draft does not submit it");
  await expect(dialog(page)).toContainText("Payslip income (OCR)");
  await dialog(page).getByLabel("Amount (pesos)").fill("100000");
  await dialog(page).getByRole("button", { name: "Create application draft" }).click();

  // A draft only: the decision has not run.
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  await expect(caseHeader(page)).toContainText("Grace Villamor");
  await expect(caseHeader(page)).toContainText("Draft");
  await expect(page.getByText("Not decided yet.")).toBeVisible();
  await expect(history(page)).toContainText(/after review of the OCR draft \(simulated/);

  await page.getByLabel("The applicant consents to a credit bureau check").check();
  await page
    .getByLabel("The applicant consents to data processing under the Data Privacy Act")
    .check();
  await page.getByRole("button", { name: "Record consent" }).click();
  await expect(page.getByText(/Captured by Paolo Tan at the branch/)).toBeVisible();
  await act(page, "Submit for decision");
  await expect(page.getByText("Referred to human review.")).toBeVisible();

  await page.getByRole("button", { name: "Request information" }).click();
  await dialog(page).getByRole("button", { name: "Send request" }).click();
  await expect(dialog(page)).toBeHidden();
  await page.getByRole("button", { name: /Simulate borrower upload: Bank statements/ }).click();
  await dialog(page).getByRole("button", { name: "Simulate borrower upload" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(caseHeader(page)).toContainText("In review");

  await expect(extracted(page)).toContainText("Simulated");
  await extracted(page)
    .getByRole("button", { name: "Read with OCR: Bank statements, last 3 months" })
    .click();
  await expect(dialog(page)).toContainText("it does not change the decision");
  await dialog(page).getByRole("button", { name: "Read with OCR" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(extracted(page)).toContainText("Bank statement analysis");
  await expect(extracted(page)).toContainText("₱54,800.00 monthly, 3 of 3 months");
  await expect(extracted(page)).toContainText("Matches the application.");
  await expect(history(page)).toContainText(/Read Bank statements, last 3 months with OCR/);
  await expect(caseHeader(page)).toContainText("In review");

  // Back on the intake screen the draft points at its case.
  await page.goto("/intake?view=all");
  await expect(
    page.getByRole("row").filter({ hasText: "Grace Villamor" }).getByRole("link", { name: /APP-/ }),
  ).toBeVisible();
});

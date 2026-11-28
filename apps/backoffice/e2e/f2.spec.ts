import { expect, test } from "@playwright/test";
import { act, caseHeader, dialog, history, openCase, signIn, submitApplication } from "./support";

/**
 * F2 — referred thin-file loan with a counter-offer, across roles (ACCEPTANCE F2-1..F2-6 and
 * R-6): Joel Reyes, ₱200,000 over 36 months, countered at ₱120,000 over 36 months.
 */
test("F2 Joel is referred, countered with a reason, refused above Ben's authority, approved by Rina and disbursed", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-JOEL", "200000", "36");

  // F2-1/F2-2: referred, score 612, grade C, with the thin-file reason and the trigger.
  await expect(page.getByText("Referred to human review.")).toBeVisible();
  await expect(page.locator('[aria-label="Grade C"]')).toBeVisible();
  await expect(page.locator('[aria-label^="Score 612 "]')).toBeVisible();
  await expect(page.getByText(/Thin bureau file/).first()).toBeVisible();
  await expect(caseHeader(page)).toContainText("In review");

  // F2-3: a counter-offer without a reason code is refused with a readable message.
  await page.getByRole("button", { name: "Recommend a decision" }).click();
  const recommend = dialog(page);
  await recommend.getByLabel("Recommendation").selectOption("COUNTER_OFFER");
  await recommend.getByLabel("Amount (pesos)").fill("120000");
  await recommend.getByLabel("Tenor (months)").fill("36");
  await recommend.getByLabel("Rationale").fill("Thin file: a smaller first loan builds history.");
  await expect(recommend.getByText("Counter-offer: ₱120,000.00 over 36 months.")).toBeVisible();
  await recommend.getByRole("button", { name: "Send to approver" }).click();
  await expect(
    recommend.getByText("Choose a reason code: this differs from the application."),
  ).toBeVisible();
  await expect(recommend).toBeVisible();
  await expect(caseHeader(page)).toContainText("In review");

  // F2-4: with reason OV04 it goes to an approver, recorded as an override.
  await recommend.getByLabel(/Reason code/).selectOption("OV04");
  await recommend.getByRole("button", { name: "Send to approver" }).click();
  await expect(recommend).toBeHidden();
  await expect(caseHeader(page)).toContainText("Awaiting approval");
  await expect(page.getByText("Override", { exact: true })).toBeVisible();

  // R-6: Ben (₱100,000, grades A–B) sees why he cannot approve; trying anyway escalates.
  await openCase(page, "ben", path);
  await expect(page.getByText(/above your approval limit/)).toBeVisible();
  await act(page, "Approve");
  await expect(dialog(page).getByRole("alert")).toContainText(/approval limit/);
  await expect(caseHeader(page)).toContainText("Escalated");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(caseHeader(page)).toContainText("Awaiting approval");

  // F2-5: Rina (₱1,000,000, grades A–C) approves the counter-offer.
  // AM-1: the case names the level of the approval matrix that may approve it.
  await openCase(page, "rina", path);
  await expect(page.getByText(/Approval matrix: L2/)).toBeVisible();
  await act(page, "Approve");
  await expect(caseHeader(page)).toContainText("Offer");
  const approvedAmount = page.getByText("Approved amount", { exact: true }).locator("..");
  await expect(approvedAmount).toContainText("₱120,000.00");
  await expect(page.getByText("Tenor", { exact: true }).locator("..")).toContainText("36 months");

  // F2-6: sign, book (maker), check (a different supervisor), disburse ₱120,000 over 36.
  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(page.getByRole("button", { name: "Submit booking for checker" })).toBeVisible();
  await act(page, "Submit booking for checker");
  await expect(page.getByText(/Waiting for a loan operations supervisor/)).toBeVisible();

  await openCase(page, "ella", path);
  await act(page, "Approve booking");
  await expect(caseHeader(page)).toContainText("Disbursed");
  await expect(
    page.getByRole("table", { name: "Repayment schedule" }).locator("tbody tr"),
  ).toHaveCount(36);
  await expect(page.getByText(/Disbursed ₱120,000\.00/)).toBeVisible();
  await expect(history(page)).toContainText("Ben Castro");
  await expect(history(page)).toContainText("Rina Aquino");

  // AM-1: the approval matrix screen lists its three levels.
  await signIn(page, "rina");
  await page.goto("/approval-matrix");
  const matrix = page.getByRole("table", { name: "Approval matrix" });
  await expect(matrix.locator("tbody tr")).toHaveCount(3);
  for (const code of ["L1", "L2", "L3"]) {
    await expect(matrix.getByText(code, { exact: true })).toBeVisible();
  }
});

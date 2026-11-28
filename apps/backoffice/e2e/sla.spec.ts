import { expect, test } from "@playwright/test";
import { signIn, submitApplication } from "./support";

/**
 * Stage SLAs and turnaround in the browser (ACCEPTANCE SLA-1, TAT-1): a referred case shows
 * its review clock in the queue and on the case page; the turnaround report shows business
 * time per stage. Renato Navarro is this file's own applicant.
 */
test("SLA-1/TAT-1 a referred case's review clock shows in the queue and on the case; the turnaround report reads it", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-RENATO", "200000", "36");
  await expect(page.getByText("Referred to human review.")).toBeVisible();
  // A fresh review has (nearly) its whole 8 business hours left; out of hours the clock waits.
  await expect(page.getByText(/^On track · (8h|7h \d+m) left$/)).toBeVisible();
  await expect(page.getByText(/Loan officer · due .* \(business hours\)/)).toBeVisible();

  await signIn(page, "paolo");
  await page.goto("/queue");
  await expect(page.getByRole("columnheader", { name: "SLA" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Renato Navarro" });
  await expect(row).toContainText(/On track · (8h|7h \d+m) left/);
  await expect(page.getByText("Past SLA", { exact: true })).toBeVisible();

  await signIn(page, "rina");
  await page.getByRole("link", { name: "Turnaround and SLA" }).click();
  await expect(page.getByRole("heading", { name: "Turnaround and SLA", level: 1 })).toBeVisible();
  const stages = page.getByRole("table", { name: "Business time per stage" });
  await expect(stages.getByRole("row").filter({ hasText: "In review" })).toContainText("8h");
  await expect(page.getByText("Open on track")).toBeVisible();
  await expect(page.getByText(/Monday to Friday, 09:00–17:00 Manila/)).toBeVisible();

  // Compliance reads it too; loan operations has no Reports group.
  await signIn(page, "diane");
  await page.goto("/reports/turnaround");
  await expect(stages).toBeVisible();
  await signIn(page, "marco");
  await expect(page.getByRole("link", { name: "Turnaround and SLA" })).toHaveCount(0);
  // SLA-3: a case in review is outside loan operations' view, and so is its clock.
  await page.goto(path);
  await expect(
    page.getByRole("alert").filter({ hasText: "No such case, or it is not visible to your role." }),
  ).toBeVisible();
  await expect(page.getByText(/On track · /)).toHaveCount(0);
});

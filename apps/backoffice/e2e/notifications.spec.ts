import { expect, test } from "@playwright/test";
import { caseHeader, dialog, signIn, submitApplication } from "./support";

/**
 * Notifications in the browser (ACCEPTANCE NTF-1, NTF-2): a referral queues a borrower email
 * through the simulated gateway, shown on the case; the recommendation alerts the approvers;
 * one approver marks it read for the role. Dante Flores (an income-mismatch referral) is this
 * file's own applicant.
 */
test("NTF-1/NTF-2 a referral messages the borrower (simulated); the recommendation alerts the approvers, read once for the role", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-DANTE", "80000", "12");
  await expect(page.getByText("Referred to human review.")).toBeVisible();
  const current = page
    .getByRole("navigation", { name: "Breadcrumb" })
    .locator('[aria-current="page"]');
  await expect(current).toHaveText(/^APP-\d+$/);
  const reference = (await current.textContent())?.trim() as string;

  // NTF-1: the borrower message is on the case, labelled simulated, whatever the sweep has done.
  const messages = page.getByRole("list", { name: "Messages to the borrower" });
  await expect(messages).toBeVisible();
  // The card (a section named by its heading) carries the Simulated label.
  await expect(
    page.getByRole("region", { name: "Messages to the borrower" }).getByText(/Simulated/),
  ).toBeVisible();
  const email = messages.getByRole("listitem").first();
  await expect(email).toContainText("Your WhiteBank loan application is being reviewed");
  await expect(email).toContainText(reference);
  await expect(email).toContainText(/Waiting to send|Sent/);
  await expect(email).toContainText("Email · Applicant, email on file");

  await page.getByRole("button", { name: "Recommend a decision" }).click();
  await dialog(page)
    .getByLabel("Rationale")
    .fill("Income confirmed by payslips: approve as asked.");
  await dialog(page).getByRole("button", { name: "Send to approver" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(caseHeader(page)).toContainText("Awaiting approval");

  // NTF-2: every approver sees it; Rina marks it read and Ben then sees it read.
  const title = `${reference} is waiting for your approval`;
  await signIn(page, "rina");
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  const alert = page.getByRole("list", { name: "Alerts" }).getByRole("listitem").filter({
    hasText: title,
  });
  await expect(alert).toContainText("New");
  await expect(alert).toContainText("for everyone in your role");
  await expect(alert.getByRole("link", { name: reference })).toHaveAttribute("href", path);
  await alert.getByRole("button", { name: `Mark "${title}" read` }).click();
  await expect(alert.getByRole("button")).toHaveCount(0);
  await expect(alert).not.toContainText("New");

  await signIn(page, "ben");
  await page.goto("/notifications");
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button")).toHaveCount(0);

  // The officer who recommended it is not alerted about his own action.
  await signIn(page, "paolo");
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import {
  act,
  caseHeader,
  dialog,
  history,
  openCase,
  signIn,
  signInWithForm,
  submitApplication,
} from "./support";

/**
 * F6 and CMP-005 in the browser (ACCEPTANCE CMP-1..CMP-5): a sanctions knockout reaches
 * Compliance's AML escalations, and a match found when screening again before disbursement
 * holds the booking until Compliance clears it. Then the audit log (AUD-5, AUD-6) shows it.
 */
test("CMP-1/CMP-2 a sanctions knockout is escalated; Compliance acknowledges and closes it", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-ERNESTO", "50000", "12");
  await expect(caseHeader(page)).toContainText("Declined");
  // The top bar's breadcrumb ends in the case reference (the current page). It says "Case"
  // until the case has loaded, so wait for the reference before reading it.
  const current = page
    .getByRole("navigation", { name: "Breadcrumb" })
    .locator('[aria-current="page"]');
  await expect(current).toHaveText(/^APP-\d+$/);
  const reference = (await current.textContent())?.trim();
  expect(reference).toMatch(/^APP-\d+$/);

  await signIn(page, "diane");
  await page.getByRole("link", { name: "AML escalations" }).click();
  await expect(page.getByRole("heading", { name: "AML escalations", level: 1 })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Ernesto Lacson" });
  await expect(row).toContainText("At application");
  await expect(row).toContainText("Open");
  await row.getByRole("link", { name: "Ernesto Lacson" }).click();

  await expect(page.getByRole("heading", { name: "Ernesto Lacson", level: 1 })).toBeVisible();
  await expect(page.getByText(/declined by the decision/)).toBeVisible();
  await expect(page.getByText("Simulated · KYC / AML screening")).toBeVisible();

  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Acknowledge", exact: true }).click();
  const title = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(title.getByText("Acknowledged", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close escalation", exact: true }).click();
  await dialog(page).getByLabel("Outcome").selectOption("CONFIRMED_MATCH");
  await dialog(page).getByLabel("Closing notes").fill("Name, birth date and ID match the list.");
  await dialog(page).getByRole("button", { name: "Close escalation", exact: true }).click();
  await expect(title.getByText("Confirmed match", { exact: true })).toBeVisible();
  await expect(page.getByText("Name, birth date and ID match the list.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close escalation" })).toHaveCount(0);

  // The case history shows the escalation work.
  await page.goto(path);
  // The case history says only that the review closed: no notes, no outcome reasoning.
  await expect(history(page)).toContainText("AML review closed; the decline stands.");
  await expect(history(page)).not.toContainText("match the list");

  // AUD-6, AUD-5: the audit log finds it by case, and the chain verifies.
  await page.goto("/audit");
  await page.getByLabel("Case reference").fill(reference ?? "");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const log = page.getByRole("table", { name: "Audit log entries, newest first" });
  await expect(log.locator("tbody tr").first()).toContainText("AML_ESCALATION_CLOSED");
  await expect(log).toContainText("CASE_CREATED");
  await page.getByRole("button", { name: "Verify the chain" }).click();
  await expect(page.getByText("Chain intact")).toBeVisible();

  // AUD-7: the administrator sees the entry without the case, its summary or details.
  await signIn(page, "leo");
  await page.goto("/audit");
  await expect(page.getByLabel("Case reference")).toHaveCount(0);
  await page.getByLabel("Action").selectOption("AML_ESCALATION_CLOSED");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const first = log.locator("tbody tr").first();
  await expect(first).toContainText("AML review closed");
  await expect(first).toContainText("A case (hidden)");
  await expect(first).toContainText("Case details are visible to Compliance only.");
  await expect(log).not.toContainText(reference ?? "APP-");
  await expect(log.getByRole("link")).toHaveCount(0);
});

test("CMP-4/CMP-5 a match before disbursement holds the booking until Compliance clears it", async ({
  page,
}) => {
  const path = await submitApplication(page, "APL-DARIO", "80000", "12");
  await expect(page.getByText("Auto-approved.")).toBeVisible();
  await openCase(page, "marco", path);
  await act(page, "Record borrower e-signature");
  await expect(page.getByRole("button", { name: "Submit booking for checker" })).toBeVisible();
  await act(page, "Submit booking for checker");

  await openCase(page, "ella", path);
  await act(page, "Approve booking");
  await expect(page.getByText(/Nothing was booked or paid out/).first()).toBeVisible();
  await expect(caseHeader(page)).toContainText("Booking failed");
  await expect(page.getByText(/Held for Compliance/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry booking" })).toBeDisabled();

  await signIn(page, "diane");
  await page.goto("/compliance/escalations");
  const row = page.getByRole("row").filter({ hasText: "Dario Mercado" });
  await expect(row).toContainText("Before disbursement");
  await row.getByRole("link", { name: "Dario Mercado" }).click();
  await expect(page.getByText(/The booking is held/)).toBeVisible();
  await page.getByRole("button", { name: "Close escalation", exact: true }).click();
  await expect(dialog(page)).toContainText(/can retry the booking/);
  await dialog(page).getByLabel("Closing notes").fill("Different birth date and ID.");
  await dialog(page).getByRole("button", { name: "Close escalation", exact: true }).click();
  await expect(
    page
      .locator("header")
      .filter({ has: page.getByRole("heading", { level: 1 }) })
      .getByText("Cleared: false positive", { exact: true }),
  ).toBeVisible();

  await openCase(page, "lito", path);
  await act(page, "Retry booking");
  await expect(caseHeader(page)).toContainText("Disbursed");
  await expect(page.getByText(/Disbursed ₱80,000\.00/)).toBeVisible();
});

test("AUD-1/AUD-7 the administrator finds their own sign-in in the audit log", async ({ page }) => {
  // Through the form: the journey asserts on the sign-in event this writes (a reused session
  // writes none).
  await signInWithForm(page, "leo");
  await page.getByRole("link", { name: "Audit log" }).click();
  await page.getByLabel("Action").selectOption("SIGN_IN_SUCCEEDED");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const log = page.getByRole("table", { name: "Audit log entries, newest first" });
  await expect(log.locator("tbody tr").first()).toContainText("Leo Santiago");
  await expect(log.locator("tbody tr").first()).toContainText("Signed in.");
});

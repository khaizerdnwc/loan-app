import { expect, type Page, test } from "@playwright/test";
import { caseHeader, dialog, history, submitApplication } from "./support";

/**
 * DC-1..DC-3 in the browser: the loan officer asks a referred applicant for documents, the
 * borrower's uploads are simulated, and the officer verifies one and rejects the other before
 * recommending. Uses Ignacio (Joel's thin-file profile), whom no other journey uses.
 */
const documents = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Documents" }) });

const row = (page: Page, name: string) =>
  documents(page).getByRole("listitem").filter({ hasText: name });

test("DC-1..DC-3 request information, simulated uploads, verify and reject, then recommend", async ({
  page,
}) => {
  await submitApplication(page, "APL-IGNACIO", "200000", "36");
  await expect(page.getByText("Referred to human review.")).toBeVisible();

  await page.getByRole("button", { name: "Request information" }).click();
  await expect(dialog(page)).toContainText("Request information from the borrower");
  await dialog(page).getByLabel("Certificate of employment").check();
  await dialog(page).getByRole("button", { name: "Send request" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(caseHeader(page)).toContainText("Information requested");
  await expect(page.getByText(/Waiting for the borrower \(simulated\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Recommend a decision" })).toHaveCount(0);

  for (const name of ["Bank statements, last 3 months", "Certificate of employment"]) {
    await row(page, name)
      .getByRole("button", { name: /Simulate borrower upload/ })
      .click();
    await expect(dialog(page)).toContainText("The borrower side is simulated");
    await dialog(page).getByRole("button", { name: "Simulate borrower upload" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(row(page, name)).toContainText("Received, to verify");
  }
  await expect(caseHeader(page)).toContainText("In review");
  await expect(row(page, "Bank statements")).toContainText("bank-statements-3-months.pdf");
  await expect(documents(page)).toContainText("Simulated");

  const recommend = page.getByRole("button", { name: "Recommend a decision" });
  await expect(recommend).toBeDisabled();
  await expect(recommend).toHaveAccessibleDescription(/Verify or reject the received documents/);

  await row(page, "Bank statements")
    .getByRole("button", { name: /^Verify/ })
    .click();
  await dialog(page).getByRole("button", { name: "Verify" }).click();
  await expect(row(page, "Bank statements")).toContainText("Verified by Paolo Tan");

  await row(page, "Certificate of employment")
    .getByRole("button", { name: /^Reject/ })
    .click();
  await dialog(page).getByLabel("What is wrong with it").fill("Unsigned by the employer.");
  await dialog(page).getByRole("button", { name: "Reject" }).click();
  await expect(row(page, "Certificate of employment")).toContainText("Rejected by Paolo Tan");
  await expect(row(page, "Certificate of employment")).toContainText("Unsigned by the employer.");

  await expect(recommend).toBeEnabled();
  await expect(history(page)).toContainText(/Requested from the borrower/);
  await expect(history(page)).toContainText(/Every requested document has arrived/);
  await expect(history(page)).toContainText(/Rejected Certificate of employment/);
});

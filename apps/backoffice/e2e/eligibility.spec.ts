import { expect, test } from "@playwright/test";
import { signIn } from "./support";

/**
 * Eligibility pre-check (ACCEPTANCE EL-2) through its screen: the loan officer checks a
 * walk-in's stated figures before applying. Nothing is stored, so no other journey is affected.
 */
test("EL-2 the loan officer pre-checks stated figures: likely eligible, with the affordable range", async ({
  page,
}) => {
  await signIn(page, "paolo");
  await page.getByRole("link", { name: "Eligibility pre-check" }).click();
  await expect(
    page.getByRole("heading", { name: "Eligibility pre-check", level: 1 }),
  ).toBeVisible();

  await page.getByLabel("Amount (pesos)").fill("150000");
  await page.getByLabel("Tenor (months)").fill("24");
  await page.getByLabel("Age (years)").fill("31");
  await page.getByLabel("Monthly income (pesos)").fill("78000");
  await page.getByLabel("Monthly obligations (pesos)").fill("9000");
  await page.getByRole("button", { name: "Check eligibility" }).click();

  await expect(page.getByText("Likely eligible")).toBeVisible();
  await expect(page.getByRole("list", { name: "Policy checks" })).toContainText("Applicant age");
  // The engine's affordable figures, labelled with their basis (Maria's ₱150,000 fits at every rate).
  const best = page.getByText("Affordable amount (engine), best grade rate", { exact: true });
  await expect(best).toBeVisible();
  await expect(best.locator("xpath=following-sibling::dd[1]")).toHaveText("₱150,000.00");
  await expect(
    page.getByText("Affordable amount (engine), highest grade rate", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /^Indicative: the most these figures can repay within the debt-service limit of .+, up to the amount asked\. Not an offer\.$/,
    ),
  ).toBeVisible();
  await expect(page.getByText(/not a decision or an offer/)).toBeVisible();
});

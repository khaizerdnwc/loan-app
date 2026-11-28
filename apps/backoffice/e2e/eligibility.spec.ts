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
  await expect(page.getByText("Affordable at the best rate")).toBeVisible();
  await expect(page.getByText(/not a decision or an offer/)).toBeVisible();
});

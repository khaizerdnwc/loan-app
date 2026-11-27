import { expect, test } from "@playwright/test";

/**
 * Smoke test: the sign-in screen lists the seeded personas, which proves the whole path
 * browser → /api proxy → API → database. The F1/F2 journeys come later.
 */
test("the sign-in screen offers the seeded personas", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in as / }).first()).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { forgetSession, signInWithForm } from "./support";

test("after signing out, a staff screen sends the browser back to sign-in", async ({ page }) => {
  await signInWithForm(page, "paolo");
  await page.getByRole("button", { name: "Sign out" }).click();
  // Signed out: no later journey reuses this session.
  forgetSession("paolo");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/queue");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

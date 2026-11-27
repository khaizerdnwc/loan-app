import { expect, test } from "@playwright/test";
import { signIn } from "./support";

test("after signing out, a staff screen sends the browser back to sign-in", async ({ page }) => {
  await signIn(page, "paolo");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/queue");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

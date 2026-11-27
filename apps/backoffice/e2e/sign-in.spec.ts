import { expect, test } from "@playwright/test";
import { TEST_PASSWORD } from "./support";

/**
 * Test sign-in through the real proxy, API and seed (Program Mechanics 1a): a wrong password
 * is refused with one message and no session; the right one lands on the role's screen. The
 * page lists no accounts (docs/TEST-ACCOUNTS.md has them).
 */
test("a wrong password is refused; the right one signs in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("textbox", { name: "Username" }).fill("rina");
  await page.getByLabel("Password", { exact: true }).fill("not-her-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The username or password is not correct." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page.getByText("Rina Aquino").first()).toBeVisible();
});

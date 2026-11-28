import { expect, test } from "@playwright/test";
import { signIn } from "./support";

/**
 * Model governance (ACCEPTANCE MG-2..MG-4) through its screen: compliance opens it from the
 * sidebar and sees the registry with the prohibited-features check, overrides and drift. Read
 * only, so it changes nothing another journey depends on.
 */
test("MG-2 compliance reads the model registry, the prohibited-features check, overrides and drift", async ({
  page,
}) => {
  await signIn(page, "diane");
  await page.getByRole("link", { name: "Model governance" }).click();
  await expect(page.getByRole("heading", { name: "Model governance", level: 1 })).toBeVisible();

  const scorecards = page.getByRole("table", {
    name: "Scorecards, their use and the prohibited-features check",
  });
  await expect(scorecards.getByText("Current")).toBeVisible();
  await expect(scorecards.getByText("None used").first()).toBeVisible();
  await expect(page.getByText(/No score may use:/)).toBeVisible();

  await expect(page.getByRole("heading", { name: "Overrides · last 30 days" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Score drift" })).toBeVisible();
  await expect(
    page.getByRole("table", {
      name: "Share of scored decisions per grade, baseline against recent",
    }),
  ).toBeVisible();
});

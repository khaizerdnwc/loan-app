import { expect, type Page, test } from "@playwright/test";
import { dialog, signIn } from "./support";

/**
 * Feature flags under maker-checker (ACCEPTANCE FF-2, FF-5) through the Feature flags screen.
 * A flag is global state: the journey switches Email and file intake back on afterwards,
 * through the same two-administrator path.
 */

interface View {
  key: string;
  enabled: boolean;
  pendingChange: { id: string } | null;
}

/** Email intake on with no pending change, as Leo (draft or withdraw) and Celia (approve). */
async function restoreOn(page: Page): Promise<void> {
  await signIn(page, "leo");
  const pending = await page.evaluate(async () => {
    const json = { "content-type": "application/json" };
    const list = (await (await fetch("/api/features/flags")).json()) as View[];
    const flag = list.find((v) => v.key === "EMAIL_INTAKE");
    if (flag?.pendingChange) {
      await fetch(`/api/features/flags/EMAIL_INTAKE/changes/${flag.pendingChange.id}/reject`, {
        method: "POST",
        headers: json,
        body: "{}",
      });
    }
    if (flag?.enabled) return null;
    await fetch("/api/features/flags/EMAIL_INTAKE/changes", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ enabled: true, reason: "End of journey" }),
    });
    const after = (await (await fetch("/api/features/flags")).json()) as View[];
    return after.find((v) => v.key === "EMAIL_INTAKE")?.pendingChange?.id ?? null;
  });
  if (!pending) return;
  await signIn(page, "celia");
  const status = await page.evaluate(
    async (id) =>
      (
        await fetch(`/api/features/flags/EMAIL_INTAKE/changes/${id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    pending,
  );
  expect(status).toBe(200);
}

test.afterEach(async ({ page }) => {
  await restoreOn(page);
});

/** The Email and file intake card on the Feature flags screen (a region named by its title). */
const intakeCard = (page: Page) => page.getByRole("region", { name: "Email and file intake" });

test("FF-2/FF-5 switching email intake off needs a second administrator; then it leaves the loan officer's sidebar", async ({
  page,
}) => {
  await signIn(page, "leo");
  await page.goto("/features");
  await expect(page.getByRole("heading", { name: "Feature flags" })).toBeVisible();
  await intakeCard(page).getByRole("button", { name: "Request switch off…" }).click();
  await expect(dialog(page)).toContainText("Ask to switch Email and file intake off?");
  await expect(dialog(page)).toContainText("Nothing changes until a second administrator");
  await dialog(page).getByLabel("Reason").fill("Pause the intake pilot");
  await dialog(page).getByRole("button", { name: "Draft change" }).click();
  await expect(dialog(page)).toBeHidden();

  // Still on; Leo cannot approve his own change, and the screen says why.
  await expect(intakeCard(page).getByText("Waiting for approval:", { exact: true })).toBeVisible();
  await expect(intakeCard(page).getByRole("button", { name: "Approve change" })).toHaveCount(0);
  await expect(page.getByText(/a different administrator must approve it/)).toBeVisible();

  // Paolo still sees intake.
  await signIn(page, "paolo");
  await page.goto("/queue");
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Email and file intake" }),
  ).toBeVisible();

  await signIn(page, "celia");
  await page.goto("/features");
  await intakeCard(page).getByRole("button", { name: "Approve change" }).click();
  await expect(dialog(page)).toContainText("Switch Email and file intake off now?");
  await dialog(page).getByRole("button", { name: "Approve change" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(intakeCard(page).getByText("Off", { exact: true })).toBeVisible();

  // Paolo's sidebar no longer offers it, and its address answers that it is switched off.
  await signIn(page, "paolo");
  await page.goto("/queue");
  await expect(
    page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Email and file intake" }),
  ).toHaveCount(0);
  await page.goto("/intake");
  await expect(
    page.getByText("Email and file intake is switched off for this bank."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Upload/ })).toHaveCount(0);
});

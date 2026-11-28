import { expect, type Page, test } from "@playwright/test";
import { caseHeader, dialog, signIn, submitApplication } from "./support";

/**
 * Automation mode under maker-checker (ACCEPTANCE AU-1, AU-2) through the Automation controls
 * screen. The mode is global state: the journey puts Personal loan back to Live afterwards,
 * through the same two-administrator path.
 */

interface View {
  productCode: string;
  mode: string;
  pendingChange: { id: string } | null;
}

/** Put PL back to live with no pending change, as Leo (draft) and Celia (approve). */
async function restoreLive(page: Page): Promise<void> {
  await signIn(page, "leo");
  const pending = await page.evaluate(async () => {
    const list = (await (await fetch("/api/automation")).json()) as View[];
    const pl = list.find((v) => v.productCode === "PL");
    if (pl?.pendingChange) {
      await fetch(`/api/automation/PL/changes/${pl.pendingChange.id}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    }
    if (pl?.mode === "LIVE") return null;
    await fetch("/api/automation/PL/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "SET_MODE", mode: "LIVE", reason: "End of journey" }),
    });
    const after = (await (await fetch("/api/automation")).json()) as View[];
    return after.find((v) => v.productCode === "PL")?.pendingChange?.id ?? null;
  });
  if (!pending) return;
  await signIn(page, "celia");
  const status = await page.evaluate(
    async (id) =>
      (
        await fetch(`/api/automation/PL/changes/${id}/approve`, {
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
  await restoreLive(page);
});

test("AU-1/AU-2 shadow mode needs a second administrator; then the engine's approval only advises", async ({
  page,
}) => {
  await signIn(page, "leo");
  await page.goto("/automation");
  await expect(page.getByRole("heading", { name: "Automation controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft change…" })).toBeDisabled();
  await page.getByLabel("Change mode for Personal loan").selectOption("SHADOW");
  await page.getByRole("button", { name: "Draft change…" }).click();
  await expect(dialog(page)).toContainText("Nothing changes until a second administrator");
  await dialog(page).getByLabel("Reason").fill("Pilot the new rule set in shadow");
  await dialog(page).getByRole("button", { name: "Draft change" }).click();
  await expect(dialog(page)).toBeHidden();

  // Still live; Leo cannot approve his own change, and the screen says why.
  await expect(page.getByText("Waiting for approval:", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve change" })).toBeDisabled();
  await expect(page.getByText(/a different administrator must approve it/)).toBeVisible();

  await signIn(page, "celia");
  await page.goto("/automation");
  await page.getByRole("button", { name: "Approve change" }).click();
  await dialog(page).getByRole("button", { name: "Approve change" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText("Shadow mode", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Personal loan automation history" })).toContainText(
    "automation is now shadow mode",
  );

  // Oscar would be auto-approved; in shadow mode a person decides.
  await submitApplication(page, "APL-OSCAR", "150000", "24");
  await expect(caseHeader(page)).toContainText("In review");
  await expect(page.getByText(/the engine's outcome was Auto-approve/)).toBeVisible();
});

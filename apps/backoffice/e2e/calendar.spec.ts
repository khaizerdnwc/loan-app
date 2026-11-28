import { expect, type Page, test } from "@playwright/test";
import { dialog, signIn } from "./support";

/**
 * The business calendar under maker-checker (ACCEPTANCE HC-3, HC-7) through the Business
 * calendar screen. The calendar is global state: the journey removes the day it added
 * afterwards, through the same two-administrator path.
 */

const NAME = "Journey typhoon suspension";

interface Calendar {
  today: string;
  holidays: { date: string; name: string }[];
  pending: { id: string; date: string; name: string }[];
}

/** A weekday about two months ahead that is not already a holiday. */
async function freeWorkday(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const view = (await (await fetch("/api/calendar")).json()) as Calendar;
    const taken = new Set(view.holidays.map((h) => h.date));
    for (let d = 60; ; d++) {
      const date = new Date(Date.parse(`${view.today}T00:00:00.000Z`) + d * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6 && !taken.has(date)) return date;
    }
  });
}

/** Withdraw any pending change and remove the journey's holiday (Leo drafts, Celia approves). */
async function restore(page: Page): Promise<void> {
  await signIn(page, "leo");
  const pending = await page.evaluate(async (name) => {
    const json = { "content-type": "application/json" };
    const view = (await (await fetch("/api/calendar")).json()) as Calendar;
    for (const c of view.pending) {
      await fetch(`/api/calendar/changes/${c.id}/reject`, {
        method: "POST",
        headers: json,
        body: "{}",
      });
    }
    const added = view.holidays.find((h) => h.name === name);
    if (!added) return null;
    const after = (await (
      await fetch("/api/calendar/changes", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ action: "REMOVE", date: added.date, reason: "End of journey" }),
      })
    ).json()) as Calendar;
    return after.pending.find((c) => c.date === added.date)?.id ?? null;
  }, NAME);
  if (!pending) return;
  await signIn(page, "celia");
  const status = await page.evaluate(
    async (id) =>
      (
        await fetch(`/api/calendar/changes/${id}/approve`, {
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
  await restore(page);
});

const ahead = (page: Page) => page.getByRole("region", { name: "Holidays ahead" });
const waiting = (page: Page) => page.getByRole("region", { name: "Waiting for approval" });

test("HC-3/HC-7 a holiday added by one administrator takes effect only when a second approves it", async ({
  page,
}) => {
  await signIn(page, "leo");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Business calendar" })).toBeVisible();
  const date = await freeWorkday(page);

  await page.getByRole("button", { name: "Request a holiday…" }).click();
  await expect(dialog(page)).toContainText("Nothing changes until a second administrator");
  await dialog(page).getByLabel("Date", { exact: true }).fill(date);
  await dialog(page).getByLabel("Name", { exact: true }).fill(NAME);
  await dialog(page).getByLabel("Reason", { exact: true }).fill("Declared for the journey");
  await dialog(page).getByRole("button", { name: "Draft change" }).click();
  await expect(dialog(page)).toBeHidden();

  // Waiting; Leo cannot approve his own change, and the screen says why.
  await expect(waiting(page)).toContainText(NAME);
  await expect(waiting(page).getByRole("button", { name: "Approve change" })).toHaveCount(0);
  await expect(waiting(page)).toContainText("a different administrator must approve it");
  await expect(ahead(page).getByText(NAME)).toHaveCount(0);

  await signIn(page, "celia");
  await page.goto("/calendar");
  await waiting(page).getByRole("button", { name: "Approve change" }).click();
  await expect(dialog(page)).toContainText("a holiday now?");
  await dialog(page).getByRole("button", { name: "Approve change" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(ahead(page).getByText(NAME)).toBeVisible();
  await expect(waiting(page)).toHaveCount(0);

  // Only administrators have the screen.
  await signIn(page, "paolo");
  await page.goto("/queue");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Business calendar" }),
  ).toHaveCount(0);
});

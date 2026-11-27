import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Each journey uses its own seeded applicant (one open application per applicant, INT-007).
 * The verify e2e stage starts a fresh throwaway database each run; against a long-lived
 * database, reseed (`pnpm db:reset`) before running the journeys again.
 *
 * Shared steps for the browser journeys. Every step goes through the real screens and the
 * same-origin /api proxy; the session is the cookie the API sets in the browser.
 */

export const PERSONA = {
  paolo: "Paolo Tan",
  rina: "Rina Aquino",
  ben: "Ben Castro",
  marco: "Marco Bautista",
  ella: "Ella Reyes",
  lito: "Lito Garcia",
  diane: "Diane Yu",
  leo: "Leo Santiago",
  celia: "Celia Ortiz",
} as const;
export type Persona = keyof typeof PERSONA;

/** The one seeded test password (packages/base/src/seed/seed.ts, docs/TEST-ACCOUNTS.md). */
export const TEST_PASSWORD = "Password123!";

/** Sign in with a test account's username and the test password; waits for the landing screen. */
export async function signIn(page: Page, persona: Persona): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Username" }).fill(persona);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** The open dialog. */
export function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/** Click an action in the case's next-action card, then confirm it in the dialog. */
export async function act(page: Page, action: string, confirm = action): Promise<void> {
  await page.getByRole("button", { name: action, exact: true }).first().click();
  await dialog(page).getByRole("button", { name: confirm, exact: true }).click();
}

/** Capture an application as Paolo and submit it; returns the case page's path. */
export async function submitApplication(
  page: Page,
  applicantId: string,
  amount: string,
  tenorMonths: string,
): Promise<string> {
  await signIn(page, "paolo");
  await page.goto("/cases/new");
  await page.getByLabel("Applicant", { exact: true }).selectOption(applicantId);
  await page.getByLabel("Amount (pesos)").fill(amount);
  await page.getByLabel("Tenor (months)").fill(tenorMonths);
  await page.getByLabel("Purpose").fill("Home improvement");
  // No consent, no bureau check: both are recorded before submitting (C-1).
  await page.getByLabel("Credit bureau check").check();
  await page.getByLabel("Data processing under the Data Privacy Act").check();
  await page.getByRole("button", { name: "Submit for decision" }).click();
  await expect(dialog(page)).toContainText("months");
  await dialog(page).getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname;
}

/** Open a case as a persona. */
export async function openCase(page: Page, persona: Persona, path: string): Promise<void> {
  await signIn(page, persona);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Next action" })).toBeVisible();
}

/** The case page's header, which holds the stage pill and the Escalated flag. */
export function caseHeader(page: Page): Locator {
  return page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
}

/** The activity history card. */
export function history(page: Page): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Activity history" }),
  });
}

/** Set a simulated service's failure mode as Leo, through the simulation screen. */
export async function setMode(page: Page, serviceLabel: string, mode: string): Promise<void> {
  await signIn(page, "leo");
  await page.goto("/simulation");
  const card = page.locator("section").filter({
    has: page.getByRole("heading", { name: serviceLabel }),
  });
  await card.getByLabel("Failure mode").selectOption(mode);
  await dialog(page).getByRole("button", { name: "Change mode" }).click();
  await expect(dialog(page)).toBeHidden();
}

/** Put every simulated service back to OK as Leo, through the API from the signed-in browser. */
export async function resetModes(page: Page): Promise<void> {
  await signIn(page, "leo");
  const statuses = await page.evaluate(async () => {
    const services = [
      "CREDIT_BUREAU",
      "KYC_AML",
      "CORE_BANKING",
      "DISBURSEMENT",
      "E_SIGNATURE",
      "FRAUD",
    ];
    const out: number[] = [];
    for (const s of services) {
      const res = await fetch(`/api/simulation/services/${s}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "OK" }),
      });
      out.push(res.status);
    }
    return out;
  });
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
}

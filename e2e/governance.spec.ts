import { expect, type Page, test } from "@playwright/test";

/**
 * Review fixes (D-025/D-026) in the browser, read-only: the audit log screen, the GDPR controls in the employee
 * panel (erasing an active employee is explained, not possible) and segregation of duties (Admin cannot close
 * accounting periods).
 */
const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("audit log: Admin sees who changed what, with before → after", async ({ page }) => {
  await login(page, "kh");
  await page.getByRole("link", { name: "Revisionsspor" }).click();
  await expect(page.getByRole("heading", { name: "Revisionsspor" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Hvem" })).toBeVisible();
  await page.getByRole("cell").getByRole("button").first().click();
  await expect(page.getByText(/^→ /).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/audit.png`, fullPage: true });
});

test("GDPR: export link and erasure explained for an active employee", async ({ page }) => {
  await login(page, "kh");
  await page.getByRole("link", { name: "Medarbejdere" }).click();
  await page
    .getByRole("button", { name: /Laura Vinther/ })
    .first()
    .click();
  await expect(page.getByRole("link", { name: /Hent alle persondata/ })).toBeVisible();
  await page.getByRole("button", { name: "Slet personoplysninger…" }).click();
  await expect(page.getByText(/stadig aktiv/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/gdpr.png`, fullPage: true });
});

test("segregation of duties: Admin does not get 'Luk måned'; Finance does", async ({ page }) => {
  await login(page, "kh");
  await page.goto("/periods");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Luk måned" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log ud" }).click();
  await login(page, "jf");
  await page.goto("/periods");
  await expect(page.getByRole("button", { name: "Luk måned" })).toBeVisible();
});

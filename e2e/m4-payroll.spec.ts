import { expect, test } from "@playwright/test";

/**
 * M4: Finance opens Løn, sees the month preview with salary-code lines and the missing-payroll-number warning, and
 * the salary-code setup. Read-only on purpose: generating/locking is covered by the API test inside a rolled-back
 * transaction, so the demo database keeps its state.
 */
const shots = process.env.E2E_SCREENSHOT_DIR;

test("payroll preview and salary codes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("jf@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page
    .getByRole("navigation", { name: "Hovedmenu" })
    .getByRole("link", { name: "Løn", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Lønoverførsel" })).toBeVisible();

  // September has approved vacation in the seed.
  await page.getByRole("button", { name: /sep\.? 2026/i }).click();
  await expect(page.getByRole("columnheader", { name: "Lønnr." })).toBeVisible();
  await expect(page.getByText("FERIE").first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m4-payroll.png`, fullPage: true });

  await page.getByRole("tab", { name: "Lønarter" }).click();
  await expect(page.getByRole("cell", { name: "KØRSEL", exact: true })).toBeVisible();
  await expect(page.getByLabel("Ferie", { exact: true })).toHaveValue(/.+/);

  // Employees do not see the menu item.
  await page.getByRole("button", { name: "Log ud" }).click();
  await page.getByLabel("E-mail").fill("lv@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Hovedmenu" }).getByRole("link", { name: "Løn", exact: true }),
  ).toHaveCount(0);
});

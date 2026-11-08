import { expect, test } from "@playwright/test";

/** M3: Finance sees a to-do list (incl. month close) and company key figures with a 12-week trend on the home page. */
const shots = process.env.E2E_SCREENSHOT_DIR;

test("home dashboard shows to-dos and key figures for Finance", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("jf@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { name: "Det venter på dig" })).toBeVisible();
  await expect(page.getByRole("link", { name: /er ikke lukket endnu/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nøgletal for virksomheden" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Udnyttelsesgrad pr. uge (12 uger)" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m3-dashboard.png`, fullPage: true });

  await page.getByRole("link", { name: /er ikke lukket endnu/ }).click();
  await expect(page).toHaveURL(/\/periods/);
});

test("an employee sees no company key figures", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("lv@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { name: "Det venter på dig" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Nøgletal/ })).toHaveCount(0);
});

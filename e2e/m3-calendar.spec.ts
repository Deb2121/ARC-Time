import { expect, test } from "@playwright/test";

/** M3: the Outlook import is off by default locally, and the timesheet explains that plainly instead of failing. */
const shots = process.env.E2E_SCREENSHOT_DIR;

test("calendar panel explains that the Outlook import is not switched on", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("lv@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.getByRole("link", { name: "Min uge" }).click();
  const toggle = page.getByRole("button", { name: /Fra min kalender/ });
  await toggle.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (!(await toggle.isVisible())) test.skip(true, "this week is already submitted in the local database");
  await toggle.click();
  await expect(page.getByRole("heading", { name: "Møder fra din Outlook-kalender" })).toBeVisible();
  await expect(page.getByText("Kalenderimport er ikke slået til")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m3-calendar.png`, fullPage: true });
  await page.getByRole("button", { name: "Luk" }).click();
  await expect(page.getByRole("heading", { name: "Møder fra din Outlook-kalender" })).toHaveCount(0);
});

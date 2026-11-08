import { expect, test } from "@playwright/test";

/** M3: a line manager opens the resource planner, filters by competence and expands an employee's bookings. */
const shots = process.env.E2E_SCREENSHOT_DIR;

test("resource planner heatmap and competence filter", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("al@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.getByRole("link", { name: "Ressourceplan" }).click();
  await expect(page.getByRole("heading", { name: "Ressourceplan" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Peter Dahl/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m3-planning.png`, fullPage: true });

  await page.getByRole("button", { name: /Peter Dahl/ }).click();
  await expect(page.getByRole("textbox", { name: /Peter Dahl, 26001/ }).first()).toBeVisible();

  await page.getByPlaceholder("Fx DGNB, Revit, brand…").fill("brand");
  await expect(page.getByRole("button", { name: /Ida Skov/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Peter Dahl/ })).toHaveCount(0);
});

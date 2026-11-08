import { expect, type Page, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials.toLowerCase()}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
}

test("unauthenticated visitors are sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Log ind" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m0-login.png`, fullPage: true });
});

test("wrong password shows an accessible error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("lv@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("forkert");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "forkert" })).toBeVisible();
});

test("a line manager signs in, sees home and their team, and signs out", async ({ page }) => {
  await login(page, "AL");
  await expect(page.getByRole("heading", { name: "Hej Anne" })).toBeVisible();
  await expect(page.getByText("Nærmeste leder")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m0-home.png`, fullPage: true });

  await page.getByRole("link", { name: "Medarbejdere" }).click();
  await expect(page.getByRole("heading", { name: "Medarbejdere" })).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(5); // header + AL, PD, LV, EK
  if (shots) await page.screenshot({ path: `${shots}/m0-people.png`, fullPage: true });

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await page.getByRole("button", { name: "Dansk" }).click();

  await page.getByRole("button", { name: "Log ud" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("a plain employee does not see the people menu", async ({ page }) => {
  await login(page, "LV");
  await expect(page.getByRole("heading", { name: "Hej Laura" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Medarbejdere" })).toHaveCount(0);
});

test("login works with the keyboard only", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").focus();
  await page.keyboard.type("kh@demo.arcnordic.test");
  await page.keyboard.press("Tab");
  await page.keyboard.type("demo1234");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Hej Karen" })).toBeVisible();
});

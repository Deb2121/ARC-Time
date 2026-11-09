import { expect, type Page, test } from "@playwright/test";

/** M3: Admin switches on the project manager step; a project manager then sees "Mine projekter" under Godkendelse. */
const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function setMode(page: Page, label: RegExp) {
  await login(page, "kh");
  await page.goto("/admin/settings?tab=approval");
  await page.getByRole("radio", { name: label }).check();
  await expect(page.getByRole("radio", { name: label })).toBeChecked();
}

test.afterEach(async ({ page }) => {
  await setMode(page, /Nærmeste leder godkender ugen/);
});

test("project manager step can be switched on and shows the project manager's tab", async ({ page }) => {
  await setMode(page, /Projektleder godkender sine projekter først/);
  if (shots) await page.screenshot({ path: `${shots}/m3-approval-mode.png`, fullPage: true });
  await page.getByRole("button", { name: "Log ud" }).click();

  await login(page, "pd"); // project manager of 26002 and 26008, not a line manager
  await page
    .getByRole("navigation", { name: "Hovedmenu" })
    .getByRole("link", { name: "Godkendelse" })
    .click();
  await expect(page.getByRole("tab", { name: "Mine projekter" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Udlæg og kørsel" })).toHaveCount(0);
  await expect(page.getByText(/Ingen timer venter på dig|Timer på dine projekter/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m3-pm-tab.png`, fullPage: true });
});

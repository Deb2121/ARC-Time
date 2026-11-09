import { expect, type Page, test } from "@playwright/test";

/**
 * Grouped sidebar (categories filtered by role, ARCtime wordmark) and absence row actions: change the reason of a
 * wrongly chosen absence type, and remove an absence row. The absence test cleans up after itself.
 */
const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("sidebar: places grouped by category and filtered by role", async ({ page }) => {
  await login(page, "jf");
  await expect(page).toHaveTitle("ARCtime");
  await expect(page.getByRole("img", { name: "ARCtime" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Hovedmenu" });
  await expect(nav.getByText("Økonomi", { exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Løn" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Alle funktioner" })).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/sidebar.png`, fullPage: true });

  await page.getByRole("button", { name: "Log ud" }).click();
  await login(page, "lv");
  await expect(nav.getByText("Min tid", { exact: true })).toBeVisible();
  await expect(nav.getByText("Økonomi", { exact: true })).toHaveCount(0);
});

test("absence: change a wrongly chosen reason, then remove the row", async ({ page }) => {
  await login(page, "ek");
  await page
    .getByRole("navigation", { name: "Hovedmenu" })
    .getByRole("link", { name: "Min uge", exact: true })
    .click();
  const select = page.locator("#absence-select");
  await select.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (!(await select.isVisible())) test.skip(true, "this week is not editable in the local database");
  for (const name of ["Orlov", "Fri uden løn"])
    if ((await select.locator("option", { hasText: name }).count()) === 0)
      test.skip(true, `${name} already in use this week`);

  // Wrong reason: "Orlov (betalt)" with 2 hours on Monday
  await select.selectOption(
    (await select.locator("option", { hasText: "Orlov" }).getAttribute("value")) ?? "",
  );
  const cell = page.getByRole("textbox", { name: /^Orlov.*, man\./ });
  await cell.fill("2");
  await cell.press("Enter");
  await expect(page.getByRole("button", { name: /Skift fraværsårsag for Orlov/ })).toBeVisible();

  // Change it to "Fri uden løn" — the hours move with it
  await page.getByRole("button", { name: /Skift fraværsårsag for Orlov/ }).click();
  const to = page.getByRole("combobox", { name: "Skift til…" });
  await to.selectOption(
    (await to.locator("option", { hasText: "Fri uden løn" }).getAttribute("value")) ?? "",
  );
  const moved = page.getByRole("textbox", { name: /^Fri uden løn, man\./ });
  await expect(moved).toHaveValue(/^2/);
  await expect(page.getByRole("textbox", { name: /^Orlov.*, man\./ })).toHaveCount(0);
  if (shots) await page.screenshot({ path: `${shots}/absence-actions.png`, fullPage: true });

  // Remove the row (asks first because it holds hours)
  await page.getByRole("button", { name: /Fjern fraværsrækken Fri uden løn/ }).click();
  await page.getByRole("button", { name: "Ja, fjern" }).click();
  await expect(page.getByRole("textbox", { name: /^Fri uden løn, man\./ })).toHaveCount(0);
});

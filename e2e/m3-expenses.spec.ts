import { expect, type Page, test } from "@playwright/test";

/** M3: an employee registers an expense with a receipt and submits it; the line manager approves it. */
const shots = process.env.E2E_SCREENSHOT_DIR;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials.toLowerCase()}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("register expense with receipt → submit → line manager approves", async ({ page, browser }) => {
  const description = `Parkering E2E ${Date.now()}`;
  await login(page, "LV");
  await page
    .getByRole("navigation", { name: "Hovedmenu" })
    .getByRole("link", { name: "Udlæg og kørsel" })
    .click();
  await page.getByRole("button", { name: "+ Nyt udlæg" }).click();
  await page.getByLabel("Type").selectOption({ label: "Parkering" });
  await page.getByLabel("Beskrivelse").fill(description);
  await page.getByLabel("Beløb inkl. moms (kr)").fill("125");
  await expect(page.getByText("Ekskl. moms 100,00 · Moms 25,00")).toBeVisible();
  await page
    .getByLabel("Kvittering")
    .setInputFiles({ name: "kvittering.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("kvittering.png")).toBeVisible();
  await page.getByRole("button", { name: "Gem udlæg" }).click();
  const row = page.getByRole("listitem").filter({ hasText: description });
  await expect(row.getByText("Kladde")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m3-expenses.png`, fullPage: true });
  await page.getByRole("button", { name: /Indsend \d+ til godkendelse/ }).click();
  await expect(row.getByText("Indsendt")).toBeVisible();

  const ctx = await browser.newContext({ locale: "da-DK", timezoneId: "Europe/Copenhagen" });
  const anne = await ctx.newPage();
  await login(anne, "AL");
  await anne.goto("/approval?tab=expenses");
  const item = anne.getByRole("listitem").filter({ hasText: description });
  await expect(item.getByText("Se kvittering")).toBeVisible();
  if (shots) await anne.screenshot({ path: `${shots}/m3-expense-approval.png`, fullPage: true });
  await item.getByRole("button", { name: "Godkend" }).click();
  await expect(item).toHaveCount(0);
  await ctx.close();

  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: description }).getByText("Godkendt"),
  ).toBeVisible();
});

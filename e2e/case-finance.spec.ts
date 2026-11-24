import { expect, type Page, test } from "@playwright/test";

/**
 * Sagsøkonomi and Debitorliste (D-029), read-only against the demo data: who sees the module, the case overview
 * (cards, fee-type labels, filters, totals row of the visible rows), the case page with its billing plan, and the
 * debtor list (ageing cards, overdue and part-paid invoices, view filter). Nothing is changed by these tests.
 */
const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
const nav = (page: Page) => page.getByRole("navigation", { name: "Hovedmenu" });

test("only finance, management and project managers see the module", async ({ page }) => {
  await login(page, "lv");
  await expect(nav(page).getByRole("link", { name: "Sagsøkonomi" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Debitorliste" })).toHaveCount(0);
  await page.getByRole("button", { name: "Log ud" }).click();
  await login(page, "jf");
  await expect(nav(page).getByRole("link", { name: "Sagsøkonomi" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Debitorliste" })).toBeVisible();
});

test("Sagsoversigt: cards, fee labels, filter and a totals row that sums the visible rows", async ({
  page,
}) => {
  await login(page, "jf");
  await nav(page).getByRole("link", { name: "Sagsøkonomi" }).click();
  await expect(page.getByRole("heading", { name: "Sagsøkonomi", level: 1 })).toBeVisible();
  await expect(page.getByText("Kan faktureres nu")).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByText("Fast honorar").first()).toBeVisible();
  await expect(table.getByText("Medgået tid").first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/sagsoversigt.png`, fullPage: true });

  await page.getByLabel("Honorarform").selectOption("medgaaet_tid");
  const rows = table.locator("tbody tr");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  await expect(table.locator("tbody").getByText("Fast honorar")).toHaveCount(0);
  await expect(table.locator("tfoot")).toContainText(`I alt (${n} sager)`);

  await page.getByRole("tab", { name: "Rater klar til fakturering" }).click();
  await expect(page.getByRole("button", { name: "Fakturér rate" }).first()).toBeVisible();
});

test("case page shows phase finance, the billing plan and the invoice history", async ({ page }) => {
  await login(page, "jf");
  await page.goto("/case-finance");
  await page.getByRole("link", { name: "26008", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Faseøkonomi/ })).toBeVisible();
  await expect(page.getByText("Ekstraarbejde", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Faktureringsplan/ })).toBeVisible();
  await expect(page.getByText("Faktureret", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fakturahistorik" })).toBeVisible();
  await expect(page.getByText("Delvist betalt").first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/sag-26008.png`, fullPage: true });
});

test("Debitorliste: ageing cards, overdue and part-paid invoices, view filter", async ({ page }) => {
  await login(page, "jf");
  await nav(page).getByRole("link", { name: "Debitorliste" }).click();
  await expect(page.getByRole("heading", { name: "Debitorliste", level: 1 })).toBeVisible();
  await expect(page.getByText("Udestående i alt")).toBeVisible();
  await expect(page.getByText(/Forfalden \d+ dage/).first()).toBeVisible();
  await expect(page.getByText("Delvist betalt").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrér betaling" }).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/debitorliste.png`, fullPage: true });
  const unpaid = await page.locator("tbody tr").count();
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  await expect.poll(() => page.locator("tbody tr").count()).toBeGreaterThan(unpaid);
});

test("a project manager sees only their own cases and cannot register payments", async ({ page }) => {
  await login(page, "al");
  await page.goto("/case-finance");
  // Column 2 shows the customer with the project manager underneath.
  const managers = page.getByRole("table").locator("tbody tr td:nth-child(2) span:nth-child(2)");
  await expect(managers.first()).toBeVisible();
  for (const text of await managers.allTextContents()) expect(text).toBe("Anne Lund");
  await page.goto("/debtors");
  await expect(page.getByRole("heading", { name: "Debitorliste", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrér betaling" })).toHaveCount(0);
});

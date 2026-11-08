import { expect, test } from "@playwright/test";

/**
 * M4 data import: Admin chooses a customer file saved by Danish Excel (Windows-1252, semicolons) and sees the dry run
 * with æøå intact, one update, one create and one row with an error — importing is blocked until it is fixed.
 * Nothing is written (the real import is covered by the API test in a rolled-back transaction).
 */
const shots = process.env.E2E_SCREENSHOT_DIR;

/** Encodes text as Windows-1252 (Latin-1 range is enough for æøå). */
const cp1252 = (s: string) => Buffer.from(s, "latin1");

test("customer import dry run with errors blocks the import", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("kh@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.getByRole("link", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: "Import af data" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Medarbejdere" })).toBeVisible();

  await page.getByLabel(/Gem som CSV i Excel/).setInputFiles({
    name: "kunder.csv",
    mimeType: "text/csv",
    buffer: cp1252(
      "Kundenummer;Navn;CVR\r\n1001;Søndergård Ejendomme;\r\n;Ny Kunde ApS;12345678\r\n;Fejl ApS;123\r\n",
    ),
  });
  await expect(page.getByText("Opret: 2 · Opdatér: 1 · Med fejl: 1")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Søndergård Ejendomme" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ugyldig CVR" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Importér 3 rækker/ })).toBeDisabled();
  if (shots) await page.screenshot({ path: `${shots}/m4-import.png`, fullPage: true });
});

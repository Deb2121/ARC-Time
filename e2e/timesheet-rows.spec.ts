import { expect, test } from "@playwright/test";

/**
 * Regression: adding the same absence type twice used to create two rows with the same React key (console error
 * "Encountered two children with the same key"). Now the row appears once and the type disappears from the list.
 */
test("an absence type can only be added once to the week", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("same key")) errors.push(m.text());
  });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("ek@demo.arcnordic.test");
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await page.getByRole("link", { name: "Min uge" }).click();
  const select = page.locator("#absence-select");
  await select.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (!(await select.isVisible())) test.skip(true, "this week is already submitted in the local database");

  const option = select.locator("option", { hasText: "Orlov" });
  if ((await option.count()) === 0) test.skip(true, "Orlov is already a row this week");
  await select.selectOption((await option.first().getAttribute("value")) ?? "");
  await expect(select.locator("option", { hasText: "Orlov" })).toHaveCount(0);
  await expect(page.locator("tbody").getByText(/^Orlov/)).toHaveCount(1);
  expect(errors).toEqual([]);
});

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * M1 core loop in the browser: register (keyboard) → submit → manager approves → employee sees approved.
 * Cleans up through the API so the test can run repeatedly against the dev database.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const shots = process.env.E2E_SCREENSHOT_DIR;

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials.toLowerCase()}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function apiLogin(request: APIRequestContext, initials: string) {
  const res = await request.post(`${API}/api/v1/auth/dev-login`, {
    data: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  return (await res.json()).csrfToken as string;
}

function monday(d = new Date()): string {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
  const wd = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - wd);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
}

const TASK = "Behovsanalyse og workshops";
const week = monday();

test.afterAll(async ({ playwright }) => {
  // Reopen Laura's week as Anne and remove the test cell as Laura.
  const anne = await playwright.request.newContext();
  const csrfA = await apiLogin(anne, "AL");
  const inbox = await (await anne.get(`${API}/api/v1/approvals?weekStart=${week}`)).json();
  const laura = inbox.items.find((i: { user: { initials: string } }) => i.user.initials === "LV");
  if (laura?.status === "approved") {
    await anne.post(`${API}/api/v1/approvals/${laura.periodId}/reopen`, {
      headers: { "x-csrf-token": csrfA },
      data: { reason: "E2E cleanup" },
    });
  }
  const lv = await playwright.request.newContext();
  const csrfL = await apiLogin(lv, "LV");
  if (laura?.status === "submitted") {
    await lv.post(`${API}/api/v1/timesheet/week/${week}/reopen`, { headers: { "x-csrf-token": csrfL } });
  }
  const tasks = await (await lv.get(`${API}/api/v1/timesheet/tasks?q=behovsanalyse`)).json();
  if (tasks[0]) {
    await lv.put(`${API}/api/v1/timesheet/entries`, {
      headers: { "x-csrf-token": csrfL },
      data: { date: week, taskId: tasks[0].taskId, hours: 0 },
    });
  }
  await anne.dispose();
  await lv.dispose();
});

test("register → submit → approve", async ({ page, browser }) => {
  // 1. Laura registers 1,5 h on Monday using the keyboard and submits.
  await login(page, "LV");
  await page.getByRole("link", { name: "Min uge" }).click();
  await expect(page.getByRole("heading", { name: /Min uge/ })).toBeVisible();

  const cell = page.getByRole("textbox", { name: new RegExp(`${TASK}, man`) });
  if ((await cell.count()) === 0) {
    const picker = page.getByRole("combobox", { name: "Tilføj opgave" });
    await picker.fill("behovsanalyse");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  await cell.click();
  await page.keyboard.type("1,5");
  await page.keyboard.press("Tab"); // saves on blur, moves to Tuesday
  await expect(cell).toHaveValue("1,50");
  if (shots) await page.screenshot({ path: `${shots}/m1-timesheet.png`, fullPage: true });

  // Invalid value shows an accessible error and is not saved
  const tuesday = page.getByRole("textbox", { name: new RegExp(`${TASK}, tirs`) });
  await tuesday.fill("1,1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "kvarter" })).toBeVisible();
  await tuesday.press("Escape");

  await page.getByRole("button", { name: "Indsend uge" }).click();
  // Below norm a confirmation appears; wait for either outcome before deciding (avoids a race).
  const confirm = page.getByRole("alertdialog");
  const submitted = page.getByText("Ugen er indsendt og afventer godkendelse.");
  await expect(confirm.or(submitted)).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Indsend uge" }).click();
  await expect(submitted).toBeVisible();
  await expect(cell).toHaveAttribute("readonly", "");

  // 2. Anne approves in her inbox.
  const ctx = await browser.newContext({ locale: "da-DK", timezoneId: "Europe/Copenhagen" });
  const anne = await ctx.newPage();
  await login(anne, "AL");
  await anne.goto(`/approval?week=${week}`);
  const lauraItem = anne.getByRole("listitem").filter({ hasText: "Laura Vinther" });
  await expect(lauraItem.getByText("Indsendt")).toBeVisible();
  if (shots) await anne.screenshot({ path: `${shots}/m1-approval.png`, fullPage: true });
  await lauraItem.getByRole("button", { name: "Godkend" }).click();
  await expect(lauraItem.getByText("Godkendt")).toBeVisible();
  await ctx.close();

  // 3. Laura sees the week as approved and read-only.
  await page.reload();
  await expect(page.getByText("Ugen er godkendt.")).toBeVisible();
});

test("project manager sees budget vs actual and the WBS", async ({ page }) => {
  await login(page, "AL");
  await page.getByRole("link", { name: "Projekter" }).click();
  await page.getByRole("link", { name: "Lyngparken – facaderenovering" }).click();
  await expect(page.getByRole("heading", { name: /Lyngparken – facaderenovering/ })).toBeVisible();
  await expect(page.getByText("Færdiggørelse")).toBeVisible();
  await expect(page.getByText("Myndighedsprojekt")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/m1-project.png`, fullPage: true });
});

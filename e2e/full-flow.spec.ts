import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * Brief §9 E2E: register → submit → approve → invoice → close period.
 * Everything is undone afterwards through the API (credit note that re-opens the hours, period reopened,
 * week reopened, test cell cleared) so the test can run again and again on the dev database.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const shots = process.env.E2E_SCREENSHOT_DIR;
const TASK = "Behovsanalyse og workshops";

function copenhagenToday(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Copenhagen" }));
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date) {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return iso(m);
}
const week = mondayOf(copenhagenToday());

async function login(page: Page, initials: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(`${initials.toLowerCase()}@demo.arcnordic.test`);
  await page.getByLabel("Adgangskode").fill("demo1234");
  await page.getByRole("button", { name: "Log ind" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
async function apiAs(request: APIRequestContext, initials: string) {
  const res = await request.post(`${API}/api/v1/auth/dev-login`, {
    data: { email: `${initials.toLowerCase()}@demo.arcnordic.test`, password: "demo1234" },
  });
  const csrf = (await res.json()).csrfToken as string;
  return { headers: { "x-csrf-token": csrf } };
}

let bookedInvoiceId: string | null = null;
let closedPeriodId: string | null = null;

test.afterAll(async ({ playwright }) => {
  const jf = await playwright.request.newContext();
  const h = await apiAs(jf, "JF");
  if (closedPeriodId)
    await jf.post(`${API}/api/v1/periods/${closedPeriodId}/reopen`, {
      ...h,
      data: { reason: "E2E cleanup" },
    });
  if (bookedInvoiceId) {
    const inv = await (await jf.get(`${API}/api/v1/invoices/${bookedInvoiceId}`)).json();
    if (inv.status === "booked") {
      const credit = await (
        await jf.post(`${API}/api/v1/invoices/${bookedInvoiceId}/credit`, {
          ...h,
          data: { reopenSources: true },
        })
      ).json();
      await jf.post(`${API}/api/v1/invoices/${credit.id}/book`, h);
    } else {
      await jf.delete(`${API}/api/v1/invoices/${bookedInvoiceId}`, h);
    }
  }
  const al = await playwright.request.newContext();
  const ha = await apiAs(al, "AL");
  const inbox = await (await al.get(`${API}/api/v1/approvals?weekStart=${week}`)).json();
  const laura = inbox.items.find((i: { user: { initials: string } }) => i.user.initials === "LV");
  if (laura?.status === "approved")
    await al.post(`${API}/api/v1/approvals/${laura.periodId}/reopen`, {
      ...ha,
      data: { reason: "E2E cleanup" },
    });
  const lv = await playwright.request.newContext();
  const hl = await apiAs(lv, "LV");
  if (laura?.status === "submitted") await lv.post(`${API}/api/v1/timesheet/week/${week}/reopen`, hl);
  const tasks = await (await lv.get(`${API}/api/v1/timesheet/tasks?q=behovsanalyse`)).json();
  if (tasks[0])
    await lv.put(`${API}/api/v1/timesheet/entries`, {
      ...hl,
      data: { date: week, taskId: tasks[0].taskId, hours: 0 },
    });
  await Promise.all([jf.dispose(), al.dispose(), lv.dispose()]);
});

test("register → submit → approve → invoice → close period", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const newCtx = () => browser.newContext({ locale: "da-DK", timezoneId: "Europe/Copenhagen" });

  // 1. Employee registers and submits
  await login(page, "LV");
  await page.goto("/timesheet");
  const cell = page.getByRole("textbox", { name: new RegExp(`${TASK}, man`) });
  if ((await cell.count()) === 0) {
    await page.getByRole("combobox", { name: "Tilføj opgave" }).fill("behovsanalyse");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  await cell.click();
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await expect(cell).toHaveValue("2,00");
  await page.getByRole("button", { name: "Indsend uge" }).click();
  // Below norm a confirmation appears; wait for either outcome before deciding (avoids a race).
  const confirm = page.getByRole("alertdialog");
  const submitted = page.getByText("Ugen er indsendt og afventer godkendelse.");
  await expect(confirm.or(submitted)).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Indsend uge" }).click();
  await expect(submitted).toBeVisible();

  // 2. Line manager approves
  const annaCtx = await newCtx();
  const anne = await annaCtx.newPage();
  await login(anne, "AL");
  await anne.goto(`/approval?week=${week}`);
  const item = anne.getByRole("listitem").filter({ hasText: "Laura Vinther" });
  await item.getByRole("button", { name: "Godkend" }).click();
  await expect(item.getByText("Godkendt")).toBeVisible();
  await annaCtx.close();

  // 3. Finance invoices the project and books the invoice
  const jfCtx = await newCtx();
  const jf = await jfCtx.newPage();
  await login(jf, "JF");
  await jf.goto("/invoicing");
  const row = jf.getByRole("row").filter({ hasText: "Kontorhus Nordvang" });
  await row.getByRole("checkbox").check();
  if (shots) await jf.screenshot({ path: `${shots}/m2-basis.png`, fullPage: true });
  await jf.getByRole("button", { name: /Opret kladde for valgte/ }).click();
  await expect(jf.getByRole("heading", { name: /Faktura/ })).toBeVisible();
  bookedInvoiceId = jf.url().split("/").pop() ?? null;
  await expect(jf.getByText("Kladde", { exact: true })).toBeVisible();
  if (shots) await jf.screenshot({ path: `${shots}/m2-invoice-draft.png`, fullPage: true });
  await jf.getByRole("button", { name: "Bogfør", exact: true }).click();
  await jf.getByRole("alertdialog").getByRole("button", { name: "Bogfør", exact: true }).click();
  await expect(jf.getByText("Bogført", { exact: true })).toBeVisible();
  await expect(jf.getByRole("heading", { name: /Faktura \d+/ })).toBeVisible();

  // The invoiced hours are gone from the basis
  await jf.goto("/invoicing");
  await expect(jf.getByRole("row").filter({ hasText: "Kontorhus Nordvang" })).toHaveCount(0);

  // 4. Finance closes the first open month (acknowledging checklist warnings)
  type Period = { id: string; month: string; status: string };
  const latestClosed = async () =>
    ((await (await jf.request.get(`${API}/api/v1/periods`)).json()) as Period[])
      .filter((p) => p.status === "closed")
      .sort((a, b) => b.month.localeCompare(a.month))[0];
  const before = (await latestClosed())?.month ?? "";
  await jf.goto("/periods");
  const closeBtn = jf.getByRole("button", { name: "Luk måned" });
  await closeBtn.click();
  const anyway = jf.getByRole("button", { name: "Luk alligevel" });
  // Either the checklist warnings appear (then acknowledge them) or the month closes at once. An older month's
  // "Genåbn" button is visible from the start, so it cannot be used as the signal.
  const newlyClosed = async () => ((await latestClosed())?.month ?? "") !== before;
  await expect.poll(async () => (await anyway.isVisible()) || (await newlyClosed())).toBe(true);
  if (await anyway.isVisible()) await anyway.click();
  await expect.poll(newlyClosed).toBe(true);
  closedPeriodId = (await latestClosed())?.id ?? null;
  if (shots) await jf.screenshot({ path: `${shots}/m2-periods.png`, fullPage: true });
  await jfCtx.close();
});

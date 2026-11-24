#!/usr/bin/env node
/**
 * Takes the screenshots for the user guide (docs/guides/brugervejledning.html) from the running app, as the demo
 * users. Read-only: it only opens pages, never saves anything. Start the app first (Start-ARCnordic-Tid.cmd).
 *
 *   node scripts/guide-screenshots.mjs [baseUrl]      → docs/guides/img/guide-*.png
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const out = fileURLToPath(new URL("../docs/guides/img/", import.meta.url));
mkdirSync(out, { recursive: true });

/** [file, user, path, optional step after load] */
const SHOTS = [
  ["login", null, "/login"],
  ["forside-okonomi", "jf", "/"],
  ["forside-medarbejder", "lv", "/"],
  ["min-uge", "lv", "/timesheet"],
  ["udlaeg", "lv", "/expenses"],
  ["godkendelse", "al", "/approval"],
  ["ressourceplan", "al", "/planning"],
  ["projekter", "jf", "/projects"],
  ["projekt", "jf", "/projects", "firstRow"],
  ["kunder", "jf", "/customers"],
  ["fakturering", "jf", "/invoicing"],
  ["sagsokonomi", "jf", "/case-finance"],
  ["sagsokonomi-rater", "jf", "/case-finance", "readyTab"],
  ["sag", "jf", "/case-finance", "case26008"],
  ["debitorliste", "jf", "/debtors"],
  ["perioder", "jf", "/periods"],
  ["lon", "jf", "/payroll"],
  ["prislister", "jf", "/admin/price-lists"],
  ["rapporter", "jf", "/reports"],
  ["revisionsspor", "kh", "/admin/audit"],
  ["medarbejdere", "kh", "/admin/people"],
  ["indstillinger", "kh", "/admin/settings"],
  ["import", "jf", "/admin/import"],
];

const browser = await chromium.launch();
const contexts = new Map();
async function pageFor(user) {
  if (!user) return (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  let ctx = contexts.get(user);
  if (!ctx) {
    ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const p = await ctx.newPage();
    await p.goto(`${base}/login`);
    await p.getByLabel("E-mail").fill(`${user}@demo.arcnordic.test`);
    await p.getByLabel("Adgangskode").fill("demo1234");
    await p.getByRole("button", { name: "Log ind" }).click();
    await p.waitForURL((u) => !u.pathname.startsWith("/login"));
    await p.getByRole("heading", { level: 1 }).first().waitFor();
    await p.close();
    contexts.set(user, ctx);
  }
  return ctx.newPage();
}

for (const [file, user, path, step] of SHOTS) {
  const page = await pageFor(user);
  await page.goto(`${base}${path}`);
  await page
    .getByRole("heading", { level: 1 })
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  if (step === "firstRow") {
    await page.getByText("Lyngparken – facaderenovering").first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { waitUntil: "commit" });
  }
  if (step === "readyTab") await page.getByRole("tab", { name: "Rater klar til fakturering" }).click();
  if (step === "case26008") await page.getByRole("link", { name: "26008", exact: true }).click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}guide-${file}.png` });
  console.log(`guide-${file}.png`);
  await page.close();
}
await browser.close();

#!/usr/bin/env node
/**
 * Renders a self-contained HTML document to an A4 PDF with page numbers, using the Chromium that Playwright installs.
 *
 *   node scripts/render-pdf.mjs <input.html> <output.pdf> "<footer text>"
 *
 * Used for the guides in docs/guides (e.g. the Power BI guide). Images are referenced relative to the HTML file.
 */
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const [input, output, footer = "ARCnordic Tid"] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/render-pdf.mjs <input.html> <output.pdf> "<footer>"');
  process.exit(1);
}
const esc = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${resolve(input).replaceAll("\\", "/")}`);
await page.pdf({
  path: output,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-family:Segoe UI,Arial;font-size:7pt;color:#888;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span>Side <span class="pageNumber"></span> af <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(`PDF: ${output}`);

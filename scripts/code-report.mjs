#!/usr/bin/env node
/**
 * Code report generator — builds "ARCnordic Tid – kodeoversigt" (Danish) as HTML and PDF from the source itself,
 * so function lists, endpoints, tables, the role matrix and test counts always match the code.
 *
 *   node scripts/code-report.mjs            → docs/report/ARCnordic-Tid-kodeoversigt.{html,pdf}
 *
 * Narrative chapters are written here; inventories (chapter 9–13) are extracted with simple, documented regexes
 * that rely on the project's own conventions (file headers, JSDoc on every export, route files, schema.ts).
 * Rendering uses the Chromium that Playwright already installs for the PDF invoices and E2E tests.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "docs", "report");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/* ───────────── source walking ───────────── */

/** All files under `dir` (relative to the repo) matching `re`, skipping build and dependency folders. */
function files(dir, re) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (["node_modules", ".next", ".venv", "__pycache__", "dist", "test-results"].includes(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (re.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out.sort();
}

/** The first sentence of a comment block (for compact tables). */
function firstSentence(text) {
  const t = text.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  return (m ? m[1] : t).slice(0, 420);
}

/** Text of a /** … *\/ block, without the stars and @tags. */
function jsdocText(block) {
  return block
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .filter((l) => !l.startsWith("@"))
    .join(" ")
    .trim();
}

/** File header + exported symbols (kind, name, signature, first JSDoc sentence) of a TypeScript file. */
function tsInventory(path) {
  const src = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const header = /^(?:"use client";\s*)?\s*\/\*\*([\s\S]*?)\*\//.exec(src);
  const exports = [];
  const re =
    /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\s*\nexport\s+(?:default\s+)?(async\s+)?(function|const|class|interface|type)\s+(\w+)([^\n]*)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [, doc, , kind, name, rest] = m;
    let sig = "";
    if (kind === "function")
      sig = `(${(/\(([^)]*)/.exec(rest)?.[1] ?? "").trim()}${rest.includes(")") ? "" : "…"})`;
    exports.push({ kind, name, sig, doc: firstSentence(jsdocText(doc)) });
  }
  return {
    path: rel(path),
    header: header ? firstSentence(jsdocText(`/**${header[1]}*/`)) : "",
    exports,
    lines: src.split("\n").length,
  };
}

/** Module docstring + top-level def/class with docstring first line, for a Python file. */
function pyInventory(path) {
  const src = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const header = /^"""([\s\S]*?)"""/.exec(src);
  const exports = [];
  const re = /^(def|class)\s+(\w+)(\([^)]*\))?[^\n]*:\n\s+"""([^\n]*)/gm;
  for (let m = re.exec(src); m; m = re.exec(src))
    if (!m[2].startsWith("_"))
      exports.push({
        kind: m[1] === "def" ? "function" : "class",
        name: m[2],
        sig: m[3] ?? "",
        doc: firstSentence(m[4].replace(/"""$/, "")),
      });
  return {
    path: rel(path),
    header: header ? firstSentence(header[1]) : "",
    exports,
    lines: src.split("\n").length,
  };
}

const isTest = (p) => /\.test\.tsx?$|[\\/]tests?[\\/]|test_\w+\.py$|\.spec\.ts$/.test(p);

/* ───────────── inventories ───────────── */

const GROUPS = [
  { title: "Domæne (packages/domain) — forretningsregler", dir: "packages/domain/src", re: /\.ts$/ },
  { title: "Database (packages/db) — skema, RLS og arbejdsgange", dir: "packages/db/src", re: /\.ts$/ },
  { title: "API-services (apps/api/src/services) — arbejdsgange", dir: "apps/api/src/services", re: /\.ts$/ },
  {
    title: "API-ruter og login (apps/api/src/routes, auth)",
    dir: "apps/api/src",
    re: /^(?!.*test).*\.ts$/,
    only: /src\/(routes|auth)\/|src\/(app|config|server)\.ts$/,
  },
  { title: "Integrationer (packages/integrations)", dir: "packages/integrations/src", re: /\.ts$/ },
  {
    title: "Web: komponenter og hjælpere (apps/web/src)",
    dir: "apps/web/src",
    re: /\.tsx?$/,
    only: /\/(components|lib|i18n)\//,
  },
  {
    title: "Python-analysetjeneste (apps/analytics)",
    dir: "apps/analytics/arc_analytics",
    re: /\.py$/,
    py: true,
  },
];

const modules = GROUPS.map((g) => ({
  ...g,
  items: files(g.dir, g.re)
    .filter((p) => !isTest(p) && !/index\.tsx?$|__init__\.py$/.test(p) && (!g.only || g.only.test(rel(p))))
    .map((p) => (g.py ? pyInventory(p) : tsInventory(p)))
    .filter((m) => m.exports.length || m.header),
}));

/** API endpoints from route files, with the capability (or role) each one checks. */
function endpoints() {
  const out = [];
  for (const p of [...files("apps/api/src/routes", /\.ts$/), join(ROOT, "apps/api/src/auth/routes.ts")]) {
    const src = readFileSync(p, "utf8");
    const re = /app\.(get|post|put|patch|delete)\(\s*\n?\s*"([^"]+)"/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const window = src.slice(m.index, m.index + 3000);
      const next = window.slice(10).search(/app\.(get|post|put|patch|delete)\(/);
      const body = next === -1 ? window : window.slice(0, next + 10);
      const cap = /requireCapability\(req,\s*(?:"([\w.]+)"|capability)/.exec(body);
      const role = /requireRole\(req,\s*([^)]+)\)/.exec(body);
      const inline = [...body.matchAll(/policy\.can\("([\w.]+)"\)/g)].map((x) => x[1]);
      const access = cap
        ? (cap[1] ?? "data.import / people.import")
        : role
          ? role[1].replaceAll('"', "")
          : inline.length
            ? inline.join(" / ")
            : /public:\s*true/.test(body)
              ? "offentlig"
              : "login + regler i service";
      out.push({
        method: m[1].toUpperCase(),
        path: `/api/v1${m[2]}`,
        file: rel(p).replace("apps/api/src/", ""),
        access,
      });
    }
  }
  return out;
}

/** Tables from schema.ts with their JSDoc and number of columns. */
function tables() {
  const src = read("packages/db/src/schema.ts").replace(/\r\n/g, "\n");
  const out = [];
  const re = /(?:(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\s*\n)?export const (\w+) = pgTable\(\s*\n?\s*"(\w+)"/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const end =
      src.indexOf("\n);", m.index) === -1
        ? src.indexOf("\n});", m.index)
        : Math.min(...[src.indexOf("\n);", m.index), src.indexOf("\n});", m.index)].filter((i) => i > 0));
    const block = src.slice(m.index, end);
    const cols = (block.match(/^\s{2,4}\w+: [\w]+\(/gm) ?? []).length;
    out.push({ name: m[3], ts: m[2], cols, doc: m[1] ? firstSentence(jsdocText(m[1])) : "" });
  }
  return out;
}

/** The role matrix rows from packages/domain/src/access.ts. */
function matrix() {
  const src = read("packages/domain/src/access.ts");
  const block = src.slice(src.indexOf("const MATRIX"), src.indexOf("};", src.indexOf("const MATRIX")));
  const rows = [];
  const re =
    /"([\w.]+)":\s*\{\s*roles:\s*\[([^\]]*)\](?:,\s*right:\s*\{\s*right:\s*"(\w+)",\s*rightFor:\s*\[([^\]]*)\])?/g;
  for (let m = re.exec(block); m; m = re.exec(block))
    rows.push({
      cap: m[1],
      roles: m[2]
        .replaceAll('"', "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      right: m[3],
      rightFor: m[4]?.replaceAll('"', "").trim(),
    });
  return rows;
}

/** Test counts per area (number of `it(` / `test(` / `def test_`). */
function tests() {
  const areas = [
    ["Domæne", "packages/domain/src", /\.test\.ts$/, /\bit\(/g],
    ["Database / RLS", "packages/db/src", /\.test\.ts$/, /\bit\(/g],
    ["Integrationer", "packages/integrations/src", /\.test\.ts$/, /\bit\(/g],
    ["API (integration mod rigtig database)", "apps/api/src", /\.test\.ts$/, /\bit\(/g],
    ["Python-analyse", "apps/analytics/tests", /\.py$/, /^def test_/gm],
    ["E2E i browser (Playwright)", "e2e", /\.spec\.ts$/, /^test\(/gm],
  ];
  return areas.map(([name, dir, re, count]) => {
    const fs = files(dir, re);
    return {
      name,
      files: fs.length,
      tests: fs.reduce((a, p) => a + (readFileSync(p, "utf8").match(count) ?? []).length, 0),
    };
  });
}

/** Lines of source and test code per package. */
function stats() {
  const pk = [
    ["packages/domain", "packages/domain/src"],
    ["packages/db", "packages/db/src"],
    ["packages/integrations", "packages/integrations/src"],
    ["packages/ui", "packages/ui/src"],
    ["apps/api", "apps/api/src"],
    ["apps/web", "apps/web/src"],
    ["apps/analytics", "apps/analytics"],
    ["e2e", "e2e"],
  ];
  return pk.map(([name, dir]) => {
    const all = files(dir, /\.(tsx?|py)$/);
    const count = (list) => list.reduce((a, p) => a + readFileSync(p, "utf8").split("\n").length, 0);
    return {
      name,
      files: all.length,
      code: count(all.filter((p) => !isTest(p))),
      tests: count(all.filter(isTest)),
    };
  });
}

/** Decision log entries: id, date, title, status. */
function decisions() {
  const src = read("docs/decisions.md");
  const out = [];
  const re = /\*\*(D-\d+) · ([\d-]+) · ([^*]+)\*\*([\s\S]*?)(?=\n\*\*D-|\n## |$)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const status = /·\s*(accepted|proposed|superseded)[^\n]*\s*$/.exec(m[4].trim())?.[1] ?? "";
    out.push({ id: m[1], date: m[2], title: m[3].trim(), status });
  }
  return out;
}

const git = (cmd) => {
  try {
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

/* ───────────── HTML ───────────── */

const S = stats();
const T = tests();
const E = endpoints();
const TB = tables();
const M = matrix();
const D = decisions();
const totals = {
  code: S.filter((s) => s.name !== "e2e").reduce((a, s) => a + s.code, 0),
  tests: S.reduce((a, s) => a + s.tests, 0),
  testCases: T.reduce((a, t) => a + t.tests, 0),
  functions: modules.reduce((a, g) => a + g.items.reduce((b, m) => b + m.exports.length, 0), 0),
};
const sha = git("rev-parse --short HEAD");
const commits = git("rev-list --count HEAD");
const today = new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeZone: "Europe/Copenhagen" }).format(
  new Date(),
);
const nf = new Intl.NumberFormat("da-DK");
const ROLE_DA = {
  employee: "Medarbejder",
  project_manager: "Projektleder",
  line_manager: "Leder",
  finance: "Økonomi",
  management: "Ledelse",
  admin: "Admin",
};
const ROLES = Object.keys(ROLE_DA);

const code = (s) => `<pre><code>${esc(s.trim())}</code></pre>`;
const accessSnippet = read("packages/domain/src/access.ts").replace(/\r\n/g, "\n");
const canMethod = accessSnippet.slice(
  accessSnippet.indexOf("  /** True when the matrix allows"),
  accessSnippet.indexOf("  /** Every capability"),
);

const html = `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>ARCnordic Tid – kodeoversigt</title>
<style>
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
:root { --brand:#CA0538; --ink:#1f1f1f; --ink2:#4a4a4a; --ink3:#777; --line:#e3e3e3; --alt:#f6f6f6; }
* { box-sizing: border-box; }
body { font-family: "Open Sans","Segoe UI",Arial,sans-serif; color: var(--ink); font-size: 9.6pt; line-height: 1.45; margin: 0; }
h1 { font-size: 22pt; font-weight: 400; margin: 0 0 4mm; }
h2 { font-size: 15pt; font-weight: 500; margin: 0 0 3mm; padding-top: 2mm; border-top: 3px solid var(--brand); break-after: avoid; }
h3 { font-size: 11pt; font-weight: 600; margin: 5mm 0 2mm; break-after: avoid; }
h4 { font-size: 9.6pt; font-weight: 600; margin: 3mm 0 1mm; break-after: avoid; font-family: Consolas, monospace; color: var(--brand); }
p { margin: 0 0 2.4mm; } ul { margin: 0 0 3mm; padding-left: 5mm; } li { margin-bottom: 1mm; }
.chapter { break-before: page; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 4mm; font-size: 8.4pt; }
th { text-align: left; background: var(--alt); color: var(--ink2); font-weight: 600; padding: 1.4mm 2mm; border-bottom: 1px solid var(--line); }
td { padding: 1.2mm 2mm; border-bottom: 1px solid var(--line); vertical-align: top; }
tr { break-inside: avoid; }
code, .mono { font-family: Consolas, "Courier New", monospace; font-size: 8.2pt; }
pre { background: #f4f4f4; border-left: 3px solid var(--brand); padding: 3mm; font-size: 7.8pt; white-space: pre-wrap; break-inside: avoid; margin: 1mm 0 4mm; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; }
.logo { font-size: 20pt; } .logo b { color: var(--brand); font-weight: 700; } .logo span { color: var(--ink3); font-weight: 300; }
.cover h1 { font-size: 30pt; margin-top: 40mm; } .muted { color: var(--ink3); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 4mm 0; }
.kpi { border: 1px solid var(--line); border-radius: 2mm; padding: 3mm; } .kpi b { display: block; font-size: 16pt; font-weight: 400; }
.kpi span { color: var(--ink3); font-size: 8pt; }
.layers { display: grid; gap: 2mm; margin: 3mm 0 5mm; }
.layer { border: 1px solid var(--line); border-left: 4px solid var(--brand); padding: 2mm 3mm; border-radius: 1mm; background: #fff; }
.layer b { display: block; } .layer small { color: var(--ink2); }
.arrow { text-align: center; color: var(--ink3); font-size: 8pt; margin: -1mm 0; }
.yes { color: #1a7f37; font-weight: 700; text-align: center; } .no { color: #bbb; text-align: center; } .part { color: #9a6700; text-align: center; font-weight: 600; }
.note { border: 1px solid var(--line); background: var(--alt); padding: 3mm; border-radius: 2mm; margin: 2mm 0 4mm; break-inside: avoid; }
.tag { display: inline-block; font-size: 7.4pt; padding: 0.3mm 1.6mm; border-radius: 1mm; background: var(--alt); color: var(--ink2); }
.mod { break-inside: avoid; margin-bottom: 3mm; }
.mod p { color: var(--ink2); margin-bottom: 1mm; }
.fn td:first-child { width: 34%; }
.toc li { margin: 0.6mm 0; }
</style></head><body>

<section class="cover">
  <div class="logo"><b>ARC</b>nordic <span>Tid</span></div>
  <div>
    <h1>Kodeoversigt og funktioner</h1>
    <p style="font-size:12pt">Arkitektur, GRASP og OOP, moduler og funktioner, datamodel, sikkerhed, test og vedligeholdelse</p>
    <div class="kpis">
      <div class="kpi"><b>${nf.format(totals.code)}</b><span>linjer kildekode</span></div>
      <div class="kpi"><b>${nf.format(totals.functions)}</b><span>dokumenterede funktioner/typer</span></div>
      <div class="kpi"><b>${nf.format(totals.testCases)}</b><span>automatiske tests</span></div>
      <div class="kpi"><b>${E.length}</b><span>API-endpoints</span></div>
    </div>
  </div>
  <div class="muted">Udarbejdet ${esc(today)} · version ${esc(sha)} (${esc(commits)} commits) · github.com/Deb2121/ARC-Time<br>
  Genereres fra koden med <span class="mono">node scripts/code-report.mjs</span> — inventarlisterne passer altid med koden.</div>
</section>

<section class="chapter">
<h2>Indhold</h2>
<ol class="toc">
<li>Resumé — hvad systemet er, og hvor det står</li><li>Arkitektur — lag, pakker og en request fra start til slut</li>
<li>GRASP og OOP i koden</li><li>Clean code — konventioner der holder koden vedligeholdelig</li>
<li>Sikkerhed og adgangsstyring (rollematrix)</li><li>Data og privatliv (GDPR)</li><li>Test og kvalitetssikring</li>
<li>Vedligeholdelse — sådan tilføjer man en funktion</li><li>Moduler og funktioner (inventar)</li><li>API-endpoints</li>
<li>Datamodel (tabeller)</li><li>Beslutningslog</li><li>Kendte begrænsninger og anbefalinger</li>
</ol>

<h2 style="margin-top:8mm">1. Resumé</h2>
<p><b>ARCnordic Tid</b> er et PSA-system (tid, projekter, budget, godkendelse, fakturering, udlæg, fravær og flex, ressourceplanlægning, løneksport og rapportering) bygget som en ren genimplementering. Systemet er bygget i faser: M0 fundament, M1 tidsregistrering og godkendelse, M2 fakturering og perioder, M3 drift (udlæg, ressourceplan, dashboard, Outlook, analyse), M4 løneksport og import, samt rettelser efter kodegennemgang (adgangspolitik, privatliv, revisionsspor, GDPR, backup).</p>
<div class="kpis">${S.filter((s) => s.code)
  .slice(0, 8)
  .map(
    (s) => `<div class="kpi"><b>${nf.format(s.code)}</b><span>${esc(s.name)} · ${s.files} filer</span></div>`,
  )
  .join("")}</div>
<p><b>Teknologi:</b> TypeScript overalt (Node 26, pnpm-monorepo), Next.js 16 og React 19 til web, Fastify 5 og Zod til API, Drizzle ORM og PostgreSQL 17 med row-level security, Python 3.12 og FastAPI til analyse. Biome (lint og format), Vitest, pytest og Playwright til test. Alt kører lokalt i Docker (D-017); driftsforslag ligger i <span class="mono">docs/operations.md</span>.</p>
<p><b>Designprincipper:</b> forretningsregler er rene funktioner i domænelaget; alle eksterne systemer sidder bag adaptere og er slået fra som standard; al adgangslogik bor ét sted (<span class="mono">AccessPolicy</span>); hver fil har en forklarende header og hver eksporteret funktion en JSDoc/docstring, håndhævet automatisk.</p>
</section>

<section class="chapter">
<h2>2. Arkitektur</h2>
<p>Koden er et monorepo med tre apps og fire pakker. Afhængigheder går kun nedad i diagrammet: domænet kender ingen andre lag, og web-appen taler kun med API'et via HTTP.</p>
<div class="layers">
 <div class="layer"><b>apps/web — Next.js (brugerflade)</b><small>Sider pr. skærm (<span class="mono">app/(app)/…</span>), genbrugelige komponenter, i18n (dansk/engelsk). Viser kun handlinger, som serverens rollematrix tillader (kapabiliteter fra <span class="mono">/me</span>).</small></div>
 <div class="arrow">HTTP + session-cookie + CSRF-header</div>
 <div class="layer"><b>apps/api — Fastify (GRASP Controller + services)</b><small><span class="mono">routes/</span>: validér (Zod) → tjek adgang (<span class="mono">requireCapability</span>) → kald service → svar. <span class="mono">services/</span>: arbejdsgange (godkendelse, fakturaer, løn, GDPR …). Baggrundsjob: outbox, påmindelser, opbevaringsfrist.</small></div>
 <div class="arrow">funktionskald</div>
 <div class="layer"><b>packages/domain — forretningsregler (Information Expert)</b><small>Rene funktioner: normtid, flex, ferie, satser, faktureringsforslag, nøgletal, løn, import, GDPR og <span class="mono">AccessPolicy</span>. Ingen I/O → hurtige, sikre tests.</small></div>
 <div class="layer"><b>packages/db — Drizzle + PostgreSQL</b><small><span class="mono">schema.ts</span> (alle tabeller), migreringer, RLS pr. virksomhed via <span class="mono">withTenant()</span>, audit-skriver, transaktionelle arbejdsgange (bogføring, perioder).</small></div>
 <div class="layer"><b>packages/integrations — adaptere (Polymorphism / Protected Variations)</b><small>e-conomic (regnskab) og Microsoft Graph (kalender). Interfaces gør dem udskiftelige; slået fra uden konfiguration.</small></div>
 <div class="layer"><b>apps/analytics — Python FastAPI (skrivebeskyttet)</b><small>Nøgletal, Excel og Power BI-datasæt via en databaserolle med kun SELECT. Formlerne spejler <span class="mono">kpi.ts</span> og testes med samme eksempler.</small></div>
</div>
<h3>En request fra start til slut — "gem en celle i ugesedlen"</h3>
<ol>
<li>Brugeren skriver 7,5 i en celle → <span class="mono">week-grid.tsx</span> sender <span class="mono">PUT /api/v1/timesheet/entries</span> med CSRF-header.</li>
<li><span class="mono">auth/plugin.ts</span> slår sessionen op (kun hash gemmes), indlæser roller og ekstra rettigheder og afviser manglende CSRF.</li>
<li><span class="mono">routes/timesheet.ts</span> validerer body med Zod og kalder <span class="mono">saveCell()</span> i <span class="mono">services/timesheet.ts</span>.</li>
<li>Servicen henter data i en transaktion med <span class="mono">app.tenant_id</span> sat (RLS), og kalder domænets <span class="mono">validateEntry()</span>: 24-timers-grænse, 0,25-trin, lukket periode, påkrævet kommentar.</li>
<li>Gemmer rækken; projektleder-stemplet nulstilles, hvis rækken ændres. Fejl kastes som <span class="mono">AppError</span> og oversættes centralt til <span class="mono">{ error: kode }</span>, som web-appen viser på dansk.</li>
</ol>
</section>

<section class="chapter">
<h2>3. GRASP og OOP i koden</h2>
<table><tr><th style="width:22%">Princip</th><th>Hvor det ses</th></tr>
<tr><td><b>Information Expert</b></td><td>Beregninger bor hos de data, de kræver: <span class="mono">norm.ts</span>, <span class="mono">flex.ts</span>, <span class="mono">rates.ts</span>, <span class="mono">invoicing.ts</span>, <span class="mono">payroll.ts</span>, <span class="mono">kpi.ts</span>; <span class="mono">AccessPolicy</span> ved, hvem der må hvad; <span class="mono">people.ts</span> ved, hvem der er leder for hvem.</td></tr>
<tr><td><b>Creator</b></td><td>Den, der ejer noget, opretter det: en uge opretter sin ugeseddel-periode (<span class="mono">ensurePeriod</span>), et projekt opretter sin første kontrakt og PL-medlemskab, en faktura sine linjer og kildereferencer.</td></tr>
<tr><td><b>Controller</b></td><td>Kun rutefilerne: validér → autorisér → delegér → svar. Ingen SQL-arbejdsgange eller regler i ruterne.</td></tr>
<tr><td><b>Low Coupling</b></td><td>Services kaster <span class="mono">AppError</span> og kender ikke HTTP. Domænet har ingen afhængigheder. Web kender kun API'ets JSON. Eksterne systemer nås kun via adaptere.</td></tr>
<tr><td><b>High Cohesion</b></td><td>Ét ansvar pr. modul: <span class="mono">project-setup.ts</span> ændrer projekter, <span class="mono">projects.ts</span> læser dem; <span class="mono">audit-log.ts</span> læser sporet, <span class="mono">audit.ts</span> skriver det.</td></tr>
<tr><td><b>Polymorphism</b></td><td><span class="mono">AccountingAdapter</span>, <span class="mono">CalendarSource</span>, <span class="mono">CalendarProvider</span>, <span class="mono">Mailer</span> — flere implementeringer bag samme interface (rigtige og falske i tests).</td></tr>
<tr><td><b>Pure Fabrication</b></td><td>Klasser/moduler for god struktur: outbox, audit-skriver, rapport/CSV-bygger, løneksport, GDPR-service, Excel-bygger.</td></tr>
<tr><td><b>Indirection</b></td><td><span class="mono">withTenant()</span> mellem kode og database; transaktionel outbox mellem bogføring og regnskabssystem; <span class="mono">/me</span>-kapabiliteter mellem server-regler og knapper i UI.</td></tr>
<tr><td><b>Protected Variations</b></td><td>RLS, triggers der gør bogførte fakturaer uforanderlige, append-only audit_log, adapter-interfaces, i18n-nøgler, rollematrix som data.</td></tr>
</table>
<h3>Objektorienteret, hvor det giver mening</h3>
<p>Kernen er bevidst <b>funktionel</b> (rene funktioner over simple data er lettest at teste og at spejle i Python). Objekter bruges, hvor de modellerer noget med tilstand og adfærd, eller en udskiftelig samarbejdspartner:</p>
<table><tr><th style="width:34%">Klasse / interface</th><th>Hvorfor et objekt</th></tr>
<tr><td class="mono">AccessPolicy</td><td>Indkapsler én persons roller + rettigheder. Metoderne <span class="mono">can()</span>, <span class="mono">capabilities()</span>, <span class="mono">seesAbsenceReason()</span>, <span class="mono">canReadAudit()</span>. Matrixen er privat data — kaldere ser aldrig rollelister.</td></tr>
<tr><td class="mono">EconomicAdapter, GraphCalendarSource</td><td>Implementerer interfaces (polymorfi); kan udskiftes uden at røre kaldere; tests bruger falske udgaver.</td></tr>
<tr><td class="mono">AppError, InvoiceError, PeriodError, IntegrationError</td><td>Fejltyper bærer HTTP-status/“prøv igen”-flag; én central fejlhåndtering oversætter dem.</td></tr>
<tr><td class="mono">Caller (Python dataclass)</td><td>Uforanderligt værdiobjekt for den indloggede i analysetjenesten.</td></tr>
</table>
<p>Eksempel — hele rollematrixen spørges gennem én metode:</p>
${code(canMethod)}
</section>

<section class="chapter">
<h2>4. Clean code — konventioner</h2>
<ul>
<li><b>Én sandhed pr. regel.</b> Rollematrix (<span class="mono">access.ts</span>), beløbslinjer (<span class="mono">isAmountLine</span>), nøgletal (<span class="mono">kpi.ts</span> + Python-spejl testet med samme eksempler).</li>
<li><b>Enheder er heltal.</b> Penge i øre, timer i centitimer (7,5 t = 750), procent i basispoint (81,08 % = 8108). Ingen kommatal i beregninger → ingen afrundingsfejl. Datoer er lokale ISO-datoer i Europe/Copenhagen.</li>
<li><b>Dokumentation håndhæves.</b> <span class="mono">scripts/check-docs.mjs</span> kræver header i hver fil og JSDoc/docstring på hver eksport (TypeScript og Python) — del af <span class="mono">pnpm check</span>, pre-commit-hook og CI.</li>
<li><b>Navne fortæller hvad.</b> Funktioner er verber (<span class="mono">saveCell</span>, <span class="mono">exportPayroll</span>), regler er navneord (<span class="mono">retentionCutoff</span>). Fejlkoder er maskinlæsbare (<span class="mono">period_closed</span>) og oversættes i UI.</li>
<li><b>Små, tynde lag.</b> Ruter er korte; arbejdsgange i services; regler i domænet. Ingen forretningslogik i React-komponenter ud over visning.</li>
<li><b>Sikker som standard.</b> Integrationer, mail og kalender er slået fra uden konfiguration; dev-login kan aldrig være slået til i produktion.</li>
<li><b>Automatisk formattering og lint</b> (Biome) — ingen stilkampe i code review.</li>
</ul>
</section>

<section class="chapter">
<h2>5. Sikkerhed og adgangsstyring</h2>
<ul>
<li><b>Login:</b> uigennemsigtige session-tokens i httpOnly-cookie (kun SHA-256-hash gemmes), CSRF-token på alle ændringer, rate limit på login. Microsoft Entra ID (OIDC + PKCE) er bygget, men slået fra lokalt.</li>
<li><b>Virksomhedsadskillelse:</b> PostgreSQL row-level security med en ikke-ejer app-rolle; hver forespørgsel kører med <span class="mono">app.tenant_id</span> sat. Analysetjenesten har sin egen rolle med kun SELECT.</li>
<li><b>Uforanderlighed:</b> bogførte fakturaer er låst af database-triggers; revisionssporet (<span class="mono">audit_log</span>) kan kun indsættes i — app-rollen har ikke UPDATE/DELETE.</li>
<li><b>Funktionsadskillelse (D-025):</b> Admin konfigurerer, Økonomi bogfører, krediterer, lukker perioder og eksporterer løn.</li>
<li><b>Privatliv (OQ-21):</b> sygdom vises som "Fravær" uden kommentar for alle andre end medarbejderen, lederen og Økonomi — i ugevisning, rapporter og analyse.</li>
</ul>
<h3>Rollematrix (genereret fra <span class="mono">access.ts</span>)</h3>
<table><tr><th>Handling</th>${ROLES.map((r) => `<th style="text-align:center">${ROLE_DA[r]}</th>`).join("")}</tr>
${M.map((r) => `<tr><td class="mono">${esc(r.cap)}</td>${ROLES.map((role) => (r.roles.includes(role) ? `<td class="yes">✔</td>` : r.right && r.rightFor?.includes(role) ? `<td class="part" title="kræver ekstra rettighed">◐</td>` : `<td class="no">–</td>`)).join("")}</tr>`).join("")}
</table>
<p class="muted">◐ = kun med ekstra rettighed (fx <span class="mono">create_projects</span>, tildeles under Medarbejdere). Hvem der ses (data-omfang: egne, egne medarbejdere, egne projekter) afgøres i <span class="mono">services/people.ts</span> og <span class="mono">services/projects.ts</span>.</p>
</section>

<section class="chapter">
<h2>6. Data og privatliv (GDPR)</h2>
<ul>
<li><b>Dataudtræk:</b> Admin → Medarbejdere → "Hent alle persondata" giver én JSON-fil med alt om personen og intet om andre (<span class="mono">exportPersonalData</span>).</li>
<li><b>Sletning af fratrådte:</b> "Slet personoplysninger" pseudonymiserer navn, e-mail, initialer og lønnummer, fjerner kommentarer og sletter ikke-bogføringsdata. Bogføringsdata bevares i 5 år efter regnskabsåret. Blokeres, hvis personen er aktiv, projektleder på aktive projekter eller leder for andre (<span class="mono">erasePerson</span>, <span class="mono">erasureBlockers</span>).</li>
<li><b>Deaktivering</b> logger ud med det samme (sessioner og kalender-tokens slettes).</li>
<li><b>Natligt job</b> sletter udløbne sessioner/tokens og logs ældre end 13 måneder og rapporterer bogføringsdata ud over fristen (sletning af regnskabsdata er en bevidst handling efter aftale med revisor).</li>
<li><b>Fortegnelse:</b> <span class="mono">docs/gdpr/processing-inventory.md</span>.</li>
</ul>
<h3>Drift og backup</h3>
<p>Lokalt tages en backup dagligt ved opstart (14 gemmes) og ved nulstilling; gendannelse er verificeret. Forslag til produktion (Azure EU, administreret PostgreSQL med point-in-time restore, Key Vault, Blob Storage, Microsoft 365-mail) og flytning ud af OneDrive står i <span class="mono">docs/operations.md</span>.</p>
</section>

<section class="chapter">
<h2>7. Test og kvalitetssikring</h2>
<table><tr><th>Område</th><th style="text-align:right">Filer</th><th style="text-align:right">Tests</th></tr>
${T.map((t) => `<tr><td>${esc(t.name)}</td><td style="text-align:right">${t.files}</td><td style="text-align:right">${t.tests}</td></tr>`).join("")}
<tr><td><b>I alt</b></td><td></td><td style="text-align:right"><b>${totals.testCases}</b></td></tr></table>
<ul>
<li><b>Domænetests</b> bruger de regneeksempler, der står i specifikationen (fx flex +0,5; 49 % færdig → 117.600 kr; 3,00 feriedage).</li>
<li><b>API-tests</b> kører mod den rigtige database med RLS. Destruktive forløb (låsning af lønperioder, import, GDPR-sletning) kører i en transaktion, der rulles tilbage — demodata røres ikke.</li>
<li><b>E2E-tests</b> kører i en rigtig browser på dansk mod produktionsbygningen i CI.</li>
<li><b>Kvalitetsport:</b> <span class="mono">pnpm check</span> = lint + dokumentationstjek + typecheck + alle tests. Pre-commit-hook kører lint, docs og typecheck; GitHub Actions kører det hele inkl. migrering, drift-tjek og E2E.</li>
</ul>
</section>

<section class="chapter">
<h2>8. Vedligeholdelse — sådan tilføjer man en funktion</h2>
<ol>
<li><b>Regel først:</b> skriv beregningen som ren funktion i <span class="mono">packages/domain/src/&lt;emne&gt;.ts</span> med JSDoc og et eksempel, og en test med tal fra specifikationen.</li>
<li><b>Data:</b> tilføj tabel/kolonne i <span class="mono">packages/db/src/schema.ts</span> → <span class="mono">drizzle-kit generate</span>; nye tabeller med <span class="mono">tenant_id</span> får RLS via skabelon-migreringen (RLS-testen fejler ellers).</li>
<li><b>Arbejdsgang:</b> service-funktion i <span class="mono">apps/api/src/services/</span>; skriv til revisionssporet ved ændringer af økonomiske data.</li>
<li><b>Adgang:</b> tilføj en kapabilitet i <span class="mono">AccessPolicy</span>, hvis handlingen er ny; brug <span class="mono">requireCapability</span> i ruten og <span class="mono">can(me, …)</span> i web.</li>
<li><b>Rute:</b> tynd Controller med Zod-skema i <span class="mono">apps/api/src/routes/</span>; registrér i <span class="mono">app.ts</span>.</li>
<li><b>UI:</b> side under <span class="mono">apps/web/src/app/(app)/</span>, tekster i <span class="mono">i18n/da.ts</span> og <span class="mono">en.ts</span>.</li>
<li><b>Test og dokumentation:</b> API-test (rul tilbage, hvis den skriver), evt. E2E; beslutning i <span class="mono">docs/decisions.md</span>; kør <span class="mono">pnpm check</span>; generér denne rapport igen.</li>
</ol>
<div class="note"><b>Hvor finder jeg …?</b> Arkitekturguiden <span class="mono">docs/architecture.md</span> (kodekort, GRASP, enheder), specifikationen <span class="mono">docs/spec/*.md</span>, beslutninger <span class="mono">docs/decisions.md</span>, åbne spørgsmål <span class="mono">docs/open-questions.md</span>, drift <span class="mono">docs/operations.md</span>, demo-gennemgange <span class="mono">docs/demo/</span>.</div>
</section>

<section class="chapter">
<h2>9. Moduler og funktioner</h2>
<p>Udtrukket automatisk fra kildekoden: filens formål (header) og hver eksporteret funktion/type med første sætning af dens dokumentation. Sidefiler (Next.js-sider) er ikke med — deres formål er deres skærm. Beskrivelserne er på engelsk, fordi kodens kommentarer bevidst skrives på engelsk, så enhver udvikler kan læse dem; brugerfladen er på dansk og engelsk.</p>
${modules
  .map(
    (g) =>
      `<h3>${esc(g.title)}</h3>${g.items
        .map(
          (m) =>
            `<div class="mod"><h4>${esc(m.path)}</h4>${m.header ? `<p>${esc(m.header)}</p>` : ""}${
              m.exports.length
                ? `<table class="fn">${m.exports.map((x) => `<tr><td class="mono">${esc(x.name)}${x.kind === "function" ? `<span class="muted">${esc(x.sig.length > 70 ? `${x.sig.slice(0, 70)}…)` : x.sig)}</span>` : ` <span class="tag">${esc(x.kind)}</span>`}</td><td>${esc(x.doc)}</td></tr>`).join("")}</table>`
                : ""
            }</div>`,
        )
        .join("")}`,
  )
  .join("")}
</section>

<section class="chapter">
<h2>10. API-endpoints</h2>
<p>${E.length} endpoints under <span class="mono">/api/v1</span>. "Adgang" er den kapabilitet (fra rollematrixen) eller regel, ruten tjekker; services begrænser derudover, <i>hvis</i> data man ser.</p>
<table><tr><th style="width:8%">Metode</th><th style="width:42%">Sti</th><th style="width:22%">Fil</th><th>Adgang</th></tr>
${E.map((e) => `<tr><td class="mono">${e.method}</td><td class="mono">${esc(e.path)}</td><td class="mono">${esc(e.file)}</td><td class="mono">${esc(e.access)}</td></tr>`).join("")}
</table>
</section>

<section class="chapter">
<h2>11. Datamodel</h2>
<p>${TB.length} tabeller i PostgreSQL (<span class="mono">packages/db/src/schema.ts</span>). Alle tabeller med <span class="mono">tenant_id</span> er beskyttet af row-level security.</p>
<table><tr><th style="width:24%">Tabel</th><th style="width:8%;text-align:right">Kolonner</th><th>Formål</th></tr>
${TB.map((t) => `<tr><td class="mono">${esc(t.name)}</td><td style="text-align:right">${t.cols}</td><td>${esc(t.doc)}</td></tr>`).join("")}
</table>
</section>

<section class="chapter">
<h2>12. Beslutningslog</h2>
<table><tr><th style="width:9%">ID</th><th style="width:13%">Dato</th><th>Beslutning</th><th style="width:12%">Status</th></tr>
${D.map((d) => `<tr><td class="mono">${d.id}</td><td>${d.date}</td><td>${esc(d.title)}</td><td>${esc(d.status)}</td></tr>`).join("")}
</table>
<p class="muted">Fuld tekst med begrundelser: <span class="mono">docs/decisions.md</span>.</p>
</section>

<section class="chapter">
<h2>13. Kendte begrænsninger og anbefalinger</h2>
<h3>Kræver beslutning hos ejeren</h3>
<ul>
<li><b>Hosting (OQ-04)</b> — forslag i <span class="mono">docs/operations.md</span>; indtil da kun lokal test med opdigtede data.</li>
<li><b>Flyt arbejdskopien ud af OneDrive (OQ-01)</b> — trin-for-trin i <span class="mono">docs/operations.md</span> §4.</li>
<li><b>Åbne fagspørgsmål</b> — flexloft, ferieoptjening, kilometersatser og moms (OQ-36), nummerserier, lønudbyder (OQ-08), offentlige kunder/OIOUBL (OQ-32), opbevaringsfrist og regnskabsår (OQ-39). Systemet kører på standardvalg indtil da.</li>
</ul>
<h3>Bevidste forenklinger</h3>
<ul>
<li>Løneksport er generisk CSV; adaptere til Danløn/DataLøn/Zenegy kommer, når udbyderen er valgt.</li>
<li>Persondata-udtræk er én JSON-fil (spec nævner ZIP med JSON+CSV).</li>
<li>Revisionssporet er append-only men endnu ikke hash-kædet (spec R2 foreslår kæde for manipulationssikring).</li>
<li>Kalender-tokens fornyes ikke automatisk (ingen refresh-tokens gemmes) — brugeren logger ind med Microsoft igen.</li>
<li>Bogføringsdata ud over 5 år rapporteres, men slettes ikke automatisk.</li>
</ul>
<h3>Gode næste skridt</h3>
<ul>
<li>Entra ID med automatisk oprettelse og gruppe → rolle (OQ-10), så roller ikke vedligeholdes to steder.</li>
<li>Projektskabeloner med faser fra ydelsesbeskrivelsen (OQ-23).</li>
<li>Mobil/PWA til tidsregistrering på byggepladsen.</li>
<li>API-tokens (spec R10), så Power BI kan opdatere automatisk.</li>
</ul>
</section>
</body></html>`;

mkdirSync(OUT, { recursive: true });
const htmlPath = join(OUT, "ARCnordic-Tid-kodeoversigt.html");
const pdfPath = join(OUT, "ARCnordic-Tid-kodeoversigt.pdf");
writeFileSync(htmlPath, html);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file:///${htmlPath.replaceAll("\\", "/")}`);
await page.pdf({
  path: pdfPath,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-family:Segoe UI,Arial;font-size:7pt;color:#888;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>ARCnordic Tid — kodeoversigt · ${esc(sha)}</span><span>Side <span class="pageNumber"></span> af <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(
  `Rapport: ${rel(pdfPath)} (${modules.reduce((a, g) => a + g.items.length, 0)} filer, ${totals.functions} funktioner/typer, ${E.length} endpoints, ${TB.length} tabeller)`,
);

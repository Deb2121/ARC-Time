#!/usr/bin/env node
/**
 * Documentation gate (see docs/architecture.md → "Documentation rules").
 *
 * Fails when, in the checked folders:
 *   1. a source file does not start with a header comment explaining its purpose, or
 *   2. an exported function / exported arrow-function constant / exported class has no JSDoc block (/** … *\/)
 *      directly above it.
 * Tests, generated files and Next.js page/layout files (whose purpose is their route) are skipped.
 * Python (apps/analytics/arc_analytics): every module needs a docstring and every top-level def/class one too.
 *
 * Run: node scripts/check-docs.mjs   (part of `pnpm check`)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FOLDERS = [
  "packages/domain/src",
  "packages/db/src",
  "packages/integrations/src",
  "apps/api/src",
  "apps/web/src/lib",
  "apps/web/src/components",
];
const SKIP = [/\.test\.tsx?$/, /\.d\.ts$/, /[\\/]index\.tsx?$/];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name) && !SKIP.some((r) => r.test(p))) yield p;
  }
}

const EXPORT_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>|const\s+(\w+)\s*=\s*(?:forwardRef|fp|memo)\b)/;

const problems = [];
for (const folder of FOLDERS) {
  for (const file of walk(join(ROOT, folder))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const first = lines.findIndex(
      (l) => l.trim() !== "" && !l.startsWith('"use client"') && !l.startsWith("'use client'"),
    );
    if (first === -1 || !(lines[first].startsWith("/**") || lines[first].startsWith("//"))) {
      problems.push(`${rel}:1  missing file header comment`);
    }
    lines.forEach((line, i) => {
      const m = EXPORT_RE.exec(line);
      if (!m) return;
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      // walk up over blank lines and biome-ignore comments to find the closing */ of a JSDoc block
      let j = i - 1;
      while (j >= 0 && (lines[j].trim() === "" || lines[j].trim().startsWith("// biome-ignore"))) j--;
      if (j < 0 || !lines[j].trim().endsWith("*/"))
        problems.push(`${rel}:${i + 1}  exported "${name}" has no JSDoc`);
    });
  }
}

// Python: module docstring + docstring on every top-level def/class.
const PY_FOLDER = "apps/analytics/arc_analytics";
for (const name of readdirSync(join(ROOT, PY_FOLDER)).filter((n) => n.endsWith(".py"))) {
  const rel = `${PY_FOLDER}/${name}`;
  const lines = readFileSync(join(ROOT, PY_FOLDER, name), "utf8").split(/\r?\n/);
  const first = lines.find((l) => l.trim() !== "");
  if (!first?.startsWith('"""')) problems.push(`${rel}:1  missing module docstring`);
  lines.forEach((line, i) => {
    const m = /^(?:async\s+)?(?:def|class)\s+(\w+)/.exec(line);
    if (!m) return;
    let j = i;
    while (j < lines.length && !lines[j].trimEnd().endsWith(":")) j++; // end of a multi-line signature
    let k = j + 1;
    while (k < lines.length && lines[k].trim() === "") k++;
    if (!lines[k]?.trim().startsWith('"""')) problems.push(`${rel}:${i + 1}  "${m[1]}" has no docstring`);
  });
}

if (problems.length) {
  console.error(
    `Documentation check failed (${problems.length}):\n${problems.map((p) => `  ${p}`).join("\n")}`,
  );
  console.error(
    "\nAdd a /** … */ comment saying what it does (units, side effects). See docs/architecture.md.",
  );
  process.exit(1);
}
console.log("Documentation check passed.");

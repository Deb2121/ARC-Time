#!/usr/bin/env node
/**
 * Launcher for the Python analytics service, so `pnpm dev` / `pnpm test` work without manual Python setup.
 *
 *   node dev.mjs dev    create .venv if needed, install requirements when they change, run uvicorn on :8000
 *   node dev.mjs start  the same without auto-reload (test version)
 *   node dev.mjs test   same setup, then run pytest
 *
 * When Python 3.12+ is not installed, `dev` prints a friendly note and exits 0 (the rest of the app still runs);
 * `test` does the same locally but fails in CI (CI=true), where Python must be present.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const mode = process.argv[2] ?? "dev";
const win = process.platform === "win32";
const venvPython = join(here, ".venv", win ? "Scripts/python.exe" : "bin/python");

/** Runs a command in this folder with inherited output; returns the exit code. */
function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: here, stdio: "inherit" }).status ?? 1;
}

/** Finds a Python ≥ 3.12 launcher as [command, ...prefixArgs], or null. */
function findPython() {
  const candidates = win ? [["py", "-3"], ["python"]] : [["python3"], ["python"]];
  for (const [cmd, ...pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info >= (3, 12))"], {
      encoding: "utf8",
    });
    if (r.status === 0 && r.stdout.trim() === "True") return [cmd, ...pre];
  }
  return null;
}

if (!existsSync(venvPython)) {
  const py = findPython();
  if (!py) {
    console.log(
      "[analytics] Python 3.12+ blev ikke fundet – analyse-tjenesten springes over (resten af appen kører).",
    );
    process.exit(mode === "test" && process.env.CI ? 1 : 0);
  }
  console.log("[analytics] Opretter Python-miljø (.venv)…");
  if (run(py[0], [...py.slice(1), "-m", "venv", ".venv"]) !== 0) process.exit(1);
}

const reqHash = createHash("sha256")
  .update(readFileSync(join(here, "requirements.txt")))
  .digest("hex");
const stamp = join(here, ".venv", ".requirements.sha256");
if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== reqHash) {
  console.log("[analytics] Installerer Python-pakker…");
  if (
    run(venvPython, [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "-q",
      "-r",
      "requirements.txt",
    ]) !== 0
  )
    process.exit(1);
  writeFileSync(stamp, reqHash);
}

if (mode === "test") process.exit(run(venvPython, ["-m", "pytest", "-q"]));
// "start" (test/production) runs without auto-reload; "dev" reloads on code changes.
const reload = mode === "dev" ? ["--reload"] : [];
process.exit(run(venvPython, ["-m", "uvicorn", "arc_analytics.main:app", ...reload, "--port", "8000"]));

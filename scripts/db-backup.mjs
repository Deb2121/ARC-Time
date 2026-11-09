#!/usr/bin/env node
/**
 * Local database backup (decision D-027). Writes a compressed pg_dump of the Docker database to backups/
 * (git-ignored) as arc_tid_YYYYMMDD-HHMMSS.dump and keeps the newest 14 files.
 *
 *   node scripts/db-backup.mjs            take a backup now
 *   node scripts/db-backup.mjs --daily    only if the newest backup is older than 20 hours (used by the start file)
 *
 * This protects a local test installation. Production uses the hosting provider's backups with point-in-time
 * restore (docs/operations.md) — not this script.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "backups");
const KEEP = 14;

/** Backup files, newest first. */
export function listBackups() {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^arc_tid_\d{8}-\d{6}\.dump$/.test(f))
    .sort()
    .reverse();
}

/** Runs pg_dump inside the db container and streams it to a new file; resolves with the file path. */
function dump() {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = join(dir, `arc_tid_${stamp}.dump`);
  return new Promise((resolve, reject) => {
    const p = spawn(
      "docker",
      ["compose", "exec", "-T", "db", "pg_dump", "-U", "arc_owner", "-d", "arc_tid", "-Fc"],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    const out = createWriteStream(file);
    p.stdout.pipe(out);
    p.on("close", (code) => {
      out.close();
      if (code === 0 && statSync(file).size > 0) resolve(file);
      else {
        if (existsSync(file)) unlinkSync(file);
        reject(new Error(`pg_dump failed (exit ${code})`));
      }
    });
  });
}

const daily = process.argv.includes("--daily");
const [newest] = listBackups();
if (daily && newest && Date.now() - statSync(join(dir, newest)).mtimeMs < 20 * 3600_000) {
  console.log(`Backup findes allerede fra i dag (${newest}).`);
  process.exit(0);
}
try {
  const file = await dump();
  console.log(`Backup gemt: ${file}`);
  for (const old of listBackups().slice(KEEP)) unlinkSync(join(dir, old));
} catch (e) {
  console.error(`Backup mislykkedes: ${e.message}`);
  process.exit(1);
}

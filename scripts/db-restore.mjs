#!/usr/bin/env node
/**
 * Restores the local database from a backup made by scripts/db-backup.mjs (decision D-027).
 *
 *   node scripts/db-restore.mjs --yes                 restore the newest backup in backups/
 *   node scripts/db-restore.mjs --yes <file.dump>     restore a specific file
 *
 * Overwrites the current database (pg_restore --clean), so `--yes` is required. A safety backup of the current
 * state is taken first. Stop the app (Ctrl+C) before restoring, then start it again.
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "backups");
const args = process.argv.slice(2);

if (!args.includes("--yes")) {
  console.error("Gendannelse overskriver databasen. Kør igen med --yes for at bekræfte.");
  process.exit(1);
}
const named = args.find((a) => a !== "--yes");
const newest = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.endsWith(".dump"))
      .sort()
      .reverse()[0]
  : undefined;
const file = named ? (isAbsolute(named) ? named : join(root, named)) : newest ? join(dir, newest) : null;
if (!file || !existsSync(file)) {
  console.error("Ingen backup fundet i backups/.");
  process.exit(1);
}

console.log("Tager en sikkerhedsbackup af den nuværende database først…");
const safety = spawnSync(process.execPath, [join(root, "scripts", "db-backup.mjs")], { stdio: "inherit" });
if (safety.status !== 0) process.exit(1);

console.log(`Gendanner ${file} …`);
const p = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "pg_restore",
    "-U",
    "arc_owner",
    "-d",
    "arc_tid",
    "--clean",
    "--if-exists",
    "--no-owner",
  ],
  { cwd: root, stdio: ["pipe", "inherit", "inherit"] },
);
createReadStream(file).pipe(p.stdin);
p.on("close", (code) => {
  if (code === 0) console.log("Gendannet. Start ARCnordic Tid igen.");
  else console.error(`pg_restore afsluttede med kode ${code} – se beskeden ovenfor.`);
  process.exit(code ?? 1);
});

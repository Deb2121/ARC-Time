/**
 * File storage for receipts (brief §4.7) — GRASP Pure Fabrication + Protected Variations: callers only see
 * `storeFile` / `readFile`; today bytes are kept on the local disk (`data/uploads/<tenant>/<file id>`, D-017 runs
 * everything locally), later this module can switch to Azure Blob/SharePoint without touching callers.
 *
 * Safety: max 10 MB; the type is decided from the file's first bytes (magic numbers), not from its name or the
 * browser's claim — only PDF, JPEG, PNG and WebP are accepted. Malware scanning is a V2 item (docs/spec/expenses.md).
 */
import { createHash } from "node:crypto";
import { readFile as fsRead, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { schema, type Tx } from "@arc-tid/db";
import { eq } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";

/** Maximum receipt size in bytes (10 MB). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ROOT = fileURLToPath(new URL("../../../../data/uploads/", import.meta.url));

/** Detects the real content type from the first bytes; null when the type is not allowed. */
export function sniffContentType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Validates and stores an uploaded file for the signed-in user; returns the file row (id used by expenses). */
export async function storeFile(tx: Tx, auth: AuthContext, filename: string, bytes: Buffer) {
  if (bytes.length === 0) throw new AppError(400, "file_empty");
  if (bytes.length > MAX_FILE_BYTES) throw new AppError(413, "file_too_large");
  const contentType = sniffContentType(bytes);
  if (!contentType) throw new AppError(415, "file_type_not_allowed");
  const [row] = await tx
    .insert(schema.files)
    .values({
      tenantId: auth.tenantId,
      ownerId: auth.userId,
      filename: filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "kvittering",
      contentType,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .returning();
  if (!row) throw new AppError(500, "file_store_failed");
  const dir = join(ROOT, auth.tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, row.id), bytes);
  return row;
}

/**
 * Reads a stored file if the caller may see it: its owner, or anyone who may see an expense that references it
 * (checked by the caller via `canSeeFile`). Returns metadata and bytes.
 */
export async function readStoredFile(tx: Tx, auth: AuthContext, fileId: string) {
  const [row] = await tx.select().from(schema.files).where(eq(schema.files.id, fileId));
  if (!row) throw new AppError(404, "not_found");
  const bytes = await fsRead(join(ROOT, auth.tenantId, row.id));
  return { row, bytes };
}

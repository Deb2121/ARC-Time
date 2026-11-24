/**
 * Sends an exported report (Excel or CSV) as a download — one place for content type and file name (D-033).
 */
import type { FastifyReply } from "fastify";

/** Replies with the file as an attachment; the file name is ASCII-safe with a UTF-8 fallback for æøå. */
export function sendExport(
  reply: FastifyReply,
  f: { type: string; filename: string; body: string | Buffer },
) {
  const ascii = f.filename.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_");
  return reply
    .header("content-type", f.type)
    .header(
      "content-disposition",
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    )
    .send(f.body);
}

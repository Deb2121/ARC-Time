/**
 * Outlook calendar import (docs/spec/integrations.md R6) — GRASP Pure Fabrication + Indirection: shows a week's
 * meetings next to the timesheet and turns the ones the user picks into draft hours on a chosen task. The calendar
 * is reached only through a `CalendarProvider` (Protected Variations), so tests use a fake and, by default, the
 * feature is simply "disabled". Read-only towards Microsoft: nothing is ever written to anyone's calendar.
 *
 * Token handling: at Entra sign-in (when enabled) the delegated access token is stored AES-256-GCM encrypted in
 * graph_tokens, with a key derived from SESSION_SECRET. It expires after about an hour; no refresh tokens are kept,
 * so the user simply signs in with Microsoft again to reconnect.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { schema, type Tx } from "@arc-tid/db";
import {
  addDays,
  type EventDay,
  fromDecimal,
  type LocalDate,
  splitEventByDay,
  toDecimal,
} from "@arc-tid/domain";
import { type CalendarSource, GraphCalendarSource, IntegrationError } from "@arc-tid/integrations";
import { and, eq, gte, lte } from "drizzle-orm";
import type { AuthContext } from "../auth/plugin.ts";
import { AppError } from "./errors.ts";
import { saveCell } from "./timesheet.ts";

/** Where the calendar comes from. `enabled: false` means the feature is switched off for the installation. */
export interface CalendarProvider {
  enabled: boolean;
  /** The signed-in user's calendar, or null when they have not connected (no valid token). */
  sourceFor(tx: Tx, auth: AuthContext): Promise<CalendarSource | null>;
}

/** disabled = not configured · not_connected = user must sign in with Microsoft · connected = events listed */
export type CalendarStatus = "disabled" | "not_connected" | "connected";

/** 32-byte AES key derived from the session secret (separate purpose string, so it is not the cookie key). */
const keyFrom = (secret: string) => createHash("sha256").update(`graph-token:${secret}`).digest();

/** Encrypts a token as "iv.tag.ciphertext" (base64url, AES-256-GCM). */
export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

/** Reverses encryptToken; throws if the value was tampered with or the secret changed. */
export function decryptToken(value: string, secret: string): string {
  const [iv, tag, enc] = value.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("bad token format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/** Stores (or replaces) the user's delegated Graph token after Entra sign-in. */
export async function storeGraphToken(
  tx: Tx,
  userId: string,
  tenantId: string,
  accessToken: string,
  expiresInSec: number,
  secret: string,
) {
  const values = {
    userId,
    tenantId,
    tokenEnc: encryptToken(accessToken, secret),
    expiresAt: new Date(Date.now() + (expiresInSec - 60) * 1000),
  };
  await tx
    .insert(schema.graphTokens)
    .values(values)
    .onConflictDoUpdate({ target: schema.graphTokens.userId, set: values });
}

/** The production provider: Microsoft Graph with the stored token (disabled unless configured). */
export function graphCalendarProvider(enabled: boolean, secret: string): CalendarProvider {
  return {
    enabled,
    async sourceFor(tx, auth) {
      if (!enabled) return null;
      const [row] = await tx
        .select()
        .from(schema.graphTokens)
        .where(eq(schema.graphTokens.userId, auth.userId));
      if (!row || row.expiresAt <= new Date()) return null;
      try {
        return new GraphCalendarSource(decryptToken(row.tokenEnc, secret));
      } catch {
        return null; // secret rotated: treat as not connected
      }
    },
  };
}

/** One meeting-day as shown in the UI (hours as decimals), with what the user already did with it. */
export interface CalendarItem extends Omit<EventDay, "hours"> {
  hours: number;
  state: "new" | "imported" | "ignored";
  taskId: string | null;
}

/** The week's meetings for the signed-in user, split per day and rounded to 0,25 h, marked as new/imported/ignored. */
export async function weekCalendar(
  tx: Tx,
  auth: AuthContext,
  provider: CalendarProvider,
  weekStart: LocalDate,
): Promise<{ status: CalendarStatus; items: CalendarItem[] }> {
  if (!provider.enabled) return { status: "disabled", items: [] };
  const source = await provider.sourceFor(tx, auth);
  if (!source) return { status: "not_connected", items: [] };
  let events: Awaited<ReturnType<CalendarSource["listEvents"]>>;
  try {
    events = await source.listEvents(weekStart, addDays(weekStart, 7));
  } catch (e) {
    if (e instanceof IntegrationError && !e.retryable) return { status: "not_connected", items: [] };
    throw new AppError(503, "calendar_unavailable");
  }
  const handled = await tx
    .select()
    .from(schema.calendarImports)
    .where(
      and(
        eq(schema.calendarImports.userId, auth.userId),
        gte(schema.calendarImports.date, weekStart),
        lte(schema.calendarImports.date, addDays(weekStart, 6)),
      ),
    );
  const items = events
    .flatMap(splitEventByDay)
    .filter((d) => d.date >= weekStart && d.date <= addDays(weekStart, 6))
    .map((d) => {
      const h = handled.find((x) => x.eventId === d.eventId && x.date === d.date);
      return {
        ...d,
        hours: toDecimal(d.hours),
        state: (h?.state ?? "new") as CalendarItem["state"],
        taskId: h?.taskId ?? null,
      };
    });
  return { status: "connected", items };
}

/** A meeting-day the user wants on the timesheet. */
export interface ImportItem {
  eventId: string;
  date: LocalDate;
  subject: string;
  taskId: string;
  hours: number;
}

/**
 * Adds each picked meeting as draft hours on the chosen task (added to what the cell already holds; the meeting
 * subject becomes the comment when the cell has none) and marks it imported. Every timesheet rule applies, because
 * it goes through saveCell; one failing item rolls back the whole import.
 */
export async function importCalendarItems(tx: Tx, auth: AuthContext, items: ImportItem[]) {
  for (const it of items) {
    const [done] = await tx
      .select({ id: schema.calendarImports.id })
      .from(schema.calendarImports)
      .where(
        and(
          eq(schema.calendarImports.userId, auth.userId),
          eq(schema.calendarImports.eventId, it.eventId),
          eq(schema.calendarImports.date, it.date),
        ),
      );
    if (done) throw new AppError(409, "already_imported");
    const [cell] = await tx
      .select({ hours: schema.timeEntries.hours, comment: schema.timeEntries.comment })
      .from(schema.timeEntries)
      .where(
        and(
          eq(schema.timeEntries.userId, auth.userId),
          eq(schema.timeEntries.date, it.date),
          eq(schema.timeEntries.taskId, it.taskId),
        ),
      );
    await saveCell(tx, auth, {
      date: it.date,
      taskId: it.taskId,
      hours: toDecimal(fromDecimal(cell?.hours ?? 0) + fromDecimal(it.hours)),
      comment: cell?.comment || it.subject,
    });
    await tx.insert(schema.calendarImports).values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      eventId: it.eventId,
      date: it.date,
      state: "imported",
      taskId: it.taskId,
      hours: it.hours,
    });
  }
  return { imported: items.length };
}

/** Marks a meeting-day as "not time to register" so it no longer shows as new. */
export async function ignoreCalendarItem(tx: Tx, auth: AuthContext, eventId: string, date: LocalDate) {
  await tx
    .insert(schema.calendarImports)
    .values({ tenantId: auth.tenantId, userId: auth.userId, eventId, date, state: "ignored" })
    .onConflictDoNothing();
  return { ignored: true };
}

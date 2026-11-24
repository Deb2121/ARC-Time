/**
 * Turns any error into a plain-language message for the user: what happened and what to do about it.
 * Users never see raw error codes, HTTP statuses or exception text — those go to the browser console only.
 * GRASP: Pure Fabrication — the single place that maps API error codes (`err.<code>` keys) to user text.
 *
 * Order: known API code (incl. "network" when the server cannot be reached) → message for the HTTP status →
 * `fallbackCode` → general message.
 * @example setError(errorText(e, t))
 */
import { da, type MessageKey } from "@/i18n/da";
import { ApiError } from "./api";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const hasKey = (key: string): key is MessageKey => key in da;

/** Message for an HTTP status when the API sent a code we have no text for. */
function statusKey(status: number): MessageKey {
  if (status === 401) return "err.unauthenticated";
  if (status === 403) return "err.forbidden";
  if (status === 404) return "err.not_found";
  if (status === 409) return "err.conflict";
  if (status === 413) return "err.file_too_large";
  if (status === 429) return "err.rate_limited";
  if (status >= 500) return "err.internal_error";
  if (status >= 400) return "err.validation_failed";
  return "common.error";
}

/**
 * User-facing text for an error thrown by `api`, `uploadFile`, fetch or the page itself.
 * @param fallbackCode code to use for errors that are not from the API (e.g. "invalid" for a number the user typed)
 */
export function errorText(e: unknown, t: Translate, fallbackCode?: string): string {
  if (e) console.error(e);
  if (e instanceof ApiError) {
    const key = `err.${e.code}`;
    return t(hasKey(key) ? key : statusKey(e.status));
  }
  if (fallbackCode && hasKey(`err.${fallbackCode}`)) return t(`err.${fallbackCode}` as MessageKey);
  return t("common.error");
}

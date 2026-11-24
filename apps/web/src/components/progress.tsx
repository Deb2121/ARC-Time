/**
 * Budget visuals shared by Projekter, the project page and Rapporter: the consumption bar, the status dot and its
 * hover text. Colours follow the same thresholds as Sagsøkonomi (D-032).
 */
import type { MessageKey } from "@/i18n/da";
import { fmtPct } from "@/lib/format";

/**
 * Budget consumption bar: neutral, amber when close, deep orange over budget (never brand red). Pass the row's
 * `health` so the bar uses the same thresholds as the status dot (D-032); without it the bar warns from 90 %.
 */
export function Progress({ bp, label, health }: { bp: number | null; label: string; health?: string }) {
  const pct = bp === null ? 0 : bp / 100;
  const level = health ?? (pct > 100 ? "over" : pct >= 90 ? "warning" : "ok");
  const colour = level === "over" ? "bg-[#c2410c]" : level === "warning" ? "bg-warning" : "bg-ink-700";
  return (
    // biome-ignore lint/a11y/useSemanticElements: native <meter> cannot be styled consistently across browsers; ARIA meter is equivalent
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt"
    >
      <div className={`h-full ${colour}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

/**
 * Small coloured dot + label for budget health (ok, warning, over, no budget); colour is never the only signal.
 */
export function HealthDot({ health, label, title }: { health: string; label: string; title?: string }) {
  const c =
    health === "over"
      ? "bg-[#c2410c]"
      : health === "warning"
        ? "bg-warning"
        : health === "ok"
          ? "bg-success"
          : "bg-ink-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-700" title={title}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${c}`} />
      {label}
    </span>
  );
}

/** Hover text for the status dot: how much is used and when the warning starts, e.g. "75 % af budget brugt …". */
export function healthTip(
  p: { hoursConsumptionBp: number | null; health: string; warningBp: number },
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  locale: "da" | "en",
): string {
  if (p.health === "no_budget") return t("pr.health.no_budget");
  return t("pr.healthTip", { used: fmtPct(p.hoursConsumptionBp, locale), warn: fmtPct(p.warningBp, locale) });
}

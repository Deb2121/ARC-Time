/** Budget consumption bar: neutral up to 90 %, amber 90–100 %, deep orange over budget (never brand red). */
export function Progress({ bp, label }: { bp: number | null; label: string }) {
  const pct = bp === null ? 0 : bp / 100;
  const colour = pct > 100 ? "bg-[#c2410c]" : pct >= 90 ? "bg-warning" : "bg-ink-700";
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

export function HealthDot({ health, label }: { health: string; label: string }) {
  const c =
    health === "over"
      ? "bg-[#c2410c]"
      : health === "warning"
        ? "bg-warning"
        : health === "ok"
          ? "bg-success"
          : "bg-ink-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-700">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${c}`} />
      {label}
    </span>
  );
}

/**
 * A case shown as "[26010] Havnehuset – ombygning af tagetage": the case number in a small tag, the name next to it
 * and an optional muted line under it (e.g. the customer). Used in Fakturering so number and name read as one unit.
 */
export function CaseLabel({
  number,
  name,
  sub,
}: {
  number: string | null | undefined;
  name: string | null | undefined;
  sub?: string | null;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      {number && (
        <span className="mt-px shrink-0 rounded-md border border-line bg-surface-alt px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink-700">
          {number}
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink-900" title={name ?? undefined}>
          {name}
        </span>
        {sub && <span className="block truncate text-xs text-ink-500">{sub}</span>}
      </span>
    </span>
  );
}

/**
 * Splits an invoice heading "26010 Havnehuset – …" into the case number and the rest, when it starts with the case
 * number; otherwise the whole heading is the name.
 */
export function splitHeading(heading: string | null, projectNumber: string | null) {
  if (heading && projectNumber && heading.startsWith(`${projectNumber} `))
    return { number: projectNumber, name: heading.slice(projectNumber.length + 1) };
  return { number: projectNumber, name: heading };
}

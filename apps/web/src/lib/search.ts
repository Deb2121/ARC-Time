/**
 * Case search: every word must appear in the case number, case name, customer or (for invoices) the invoice
 * number/heading. "26010" finds that case; "fjord 260" narrows to the customer's 260xx cases.
 */
export function matchesSearch(q: string, ...fields: (string | number | null | undefined)[]): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields
    .filter((f) => f !== null && f !== undefined)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

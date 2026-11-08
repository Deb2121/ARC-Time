"""Key figures — the Python mirror of packages/domain/src/kpi.ts (GRASP Information Expert).

Same inputs and outputs as the TypeScript version so every report agrees: hours in centi-hours (int), money in
øre (int), percentages in basis points (int, 8108 = 81,08 %). Rounding is half away from zero, like divRound().
tests/test_kpi.py uses the worked examples from docs/spec/reporting.md that kpi.test.ts also uses.
"""

from __future__ import annotations


def div_round(numerator: int, denominator: int) -> int:
    """Integer division rounding half away from zero (mirror of divRound in money.ts)."""
    if denominator == 0:
        raise ZeroDivisionError("division by zero")
    q = abs(numerator) * 2 + abs(denominator)
    result = q // (2 * abs(denominator))
    return result if (numerator >= 0) == (denominator > 0) else -result


def _ratio(a: int, b: int) -> int | None:
    """Basis points of a ÷ b, or None when b is zero."""
    return div_round(a * 10_000, b) if b > 0 else None


def utilisation(billable: int, norm: int) -> int | None:
    """Utilisation ("udnyttelsesgrad"): billable hours ÷ norm hours, in basis points."""
    return _ratio(billable, norm)


def billable_pct(billable: int, work: int) -> int | None:
    """Billable share ("faktureringsgrad"): billable ÷ all registered work hours, in basis points."""
    return _ratio(billable, work)


def effective_rate(invoiced: int, hours: int) -> int | None:
    """Effective hourly rate: invoiced øre ÷ invoiced centi-hours, in øre per hour (None without hours)."""
    return div_round(invoiced * 100, hours) if hours > 0 else None


def margin(revenue: int, cost: int) -> tuple[int, int | None]:
    """Contribution margin ("dækningsbidrag") in øre and margin % ("DB-grad") in basis points."""
    return revenue - cost, _ratio(revenue - cost, revenue)

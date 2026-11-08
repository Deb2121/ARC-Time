"""Worked examples from docs/spec/reporting.md (R2–R6) — identical to packages/domain/src/kpi.test.ts."""

from arc_analytics.kpi import billable_pct, div_round, effective_rate, margin, utilisation


def kr(amount: int) -> int:
    """Kroner → øre."""
    return amount * 100


def test_utilisation_120_of_148_is_81_1_pct() -> None:
    assert utilisation(12_000, 14_800) == 8108
    assert utilisation(100, 0) is None


def test_billable_pct_120_of_150_is_80_pct() -> None:
    assert billable_pct(12_000, 15_000) == 8000


def test_effective_rate_114000_kr_for_120_h_is_950() -> None:
    assert effective_rate(kr(114_000), 12_000) == kr(950)


def test_margin_117600_minus_44100() -> None:
    assert margin(kr(117_600), kr(44_100)) == (kr(73_500), 6250)


def test_div_round_half_away_from_zero_like_typescript() -> None:
    assert div_round(5, 2) == 3
    assert div_round(-5, 2) == -3
    assert div_round(4, 3) == 1

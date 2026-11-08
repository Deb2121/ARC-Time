"""Excel export — GRASP Pure Fabrication: turns KPI rows into a tidy .xlsx workbook (openpyxl).

Values are written as real numbers (hours as decimals, kroner, percentages as fractions with a % format), so the
finance team can keep calculating in Excel. Column headers are Danish, like the rest of the product.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

HEADER_FILL = PatternFill("solid", fgColor="1F1F1F")
HEADER_FONT = Font(bold=True, color="FFFFFF")
HOURS = "#,##0.00"
KR = "#,##0"
PCT = "0.0%"


def _hours(v: int | None) -> float | None:
    """Centi-hours → decimal hours."""
    return None if v is None else v / 100


def _kr(v: int | None) -> float | None:
    """Øre → kroner."""
    return None if v is None else v / 100


def _pct(v: int | None) -> float | None:
    """Basis points → fraction for Excel's % format."""
    return None if v is None else v / 10_000


def _sheet(wb: Workbook, title: str, columns: list[tuple[str, str | None]], rows: list[list[Any]]) -> None:
    """Adds a sheet with a styled header row, number formats per column and frozen header."""
    ws = wb.create_sheet(title)
    ws.append([c[0] for c in columns])
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
    for r in rows:
        ws.append(r)
    for i, (name, fmt) in enumerate(columns, start=1):
        letter = get_column_letter(i)
        ws.column_dimensions[letter].width = max(12, len(name) + 4)
        if fmt:
            for cell in ws[letter][1:]:
                cell.number_format = fmt
    ws.freeze_panes = "A2"


def kpi_workbook(projects: list[dict[str, Any]], employees: list[dict[str, Any]], date_from: str, date_to: str) -> bytes:
    """Builds the KPI workbook (sheets: Projekter, Medarbejdere, Om) and returns the .xlsx bytes."""
    wb = Workbook()
    wb.remove(wb.active)
    _sheet(
        wb,
        "Projekter",
        [("Projekt", None), ("Navn", None), ("Kunde", None), ("Timer", HOURS), ("Fakturerbare timer", HOURS),
         ("Faktureringsgrad", PCT), ("Kostpris (kr)", KR), ("Faktureret (kr)", KR), ("Effektiv timepris (kr)", KR),
         ("Dækningsbidrag (kr)", KR), ("DB-grad", PCT)],
        [[p["number"], p["name"], p["customer"], _hours(p["hours"]), _hours(p["billable"]), _pct(p["billable_bp"]),
          _kr(p["cost"]), _kr(p["revenue"]), _kr(p["effective_rate"]), _kr(p["margin"]), _pct(p["margin_bp"])]
         for p in projects],
    )
    _sheet(
        wb,
        "Medarbejdere",
        [("Initialer", None), ("Navn", None), ("Afdeling", None), ("Arbejdstimer", HOURS),
         ("Fakturerbare timer", HOURS), ("Fravær (timer)", HOURS), ("Faktureringsgrad", PCT)],
        [[e["initials"], e["full_name"], e["department"], _hours(e["work"]), _hours(e["billable"]),
          _hours(e["absence"]), _pct(e["billable_bp"])] for e in employees],
    )
    about = wb.create_sheet("Om")
    for line in (
        ["ARCnordic Tid – nøgletal"],
        ["Periode", f"{date_from} – {date_to}"],
        ["Timer", "Indsendte, godkendte og fakturerede timer (kladder tæller ikke med)"],
        ["Faktureringsgrad", "Fakturerbare timer ÷ alle arbejdstimer"],
        ["Effektiv timepris", "Faktureret beløb ÷ fakturerede timer i perioden"],
        ["Dækningsbidrag", "Faktureret i perioden − kostpris for periodens timer"],
    ):
        about.append(line)
    about["A1"].font = Font(bold=True, size=14)
    about.column_dimensions["A"].width = 22
    about.column_dimensions["B"].width = 70
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()

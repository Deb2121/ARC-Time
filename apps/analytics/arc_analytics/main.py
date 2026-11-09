"""ARCnordic Tid analytics service (D-002, D-021) — FastAPI, read-only. GRASP Controller: each endpoint checks the
caller, opens a tenant-scoped read-only cursor and delegates to queries.py / excel.py.

    GET /health                                        liveness
    GET /v1/kpi?from=&to=                              project and employee KPIs as JSON
    GET /v1/kpi.xlsx?from=&to=                         the same as an Excel workbook
    GET /v1/datasets/{name}?from=&to=                  flat table for Power BI (time_entries, projects, employees, invoices)

Access: Finance, Management and Admin, identified by the normal sign-in cookie (arc_sid). Run with `pnpm dev`
(apps/analytics/dev.mjs starts uvicorn on port 8000).
"""

from __future__ import annotations

import os
from datetime import date
from typing import Annotated, Any

from fastapi import Cookie, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import db, excel, queries

db.load_env()
ALLOWED_ROLES = frozenset({"finance", "management", "admin"})

app = FastAPI(title="ARCnordic Tid analytics", version="1.0.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("WEB_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=[],
)


def current_caller(arc_sid: Annotated[str | None, Cookie()] = None) -> db.Caller:
    """Resolves the signed-in caller from the session cookie; 401 without a session, 403 without a KPI role."""
    caller = db.caller_from_session(arc_sid or "")
    if caller is None:
        raise HTTPException(status_code=401, detail="unauthenticated")
    if not caller.roles & ALLOWED_ROLES:
        raise HTTPException(status_code=403, detail="forbidden")
    return caller


def period(
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> tuple[str, str]:
    """Validated inclusive period (from ≤ to, at most about 2 years)."""
    if date_to < date_from or (date_to - date_from).days > 800:
        raise HTTPException(status_code=400, detail="invalid_period")
    return date_from.isoformat(), date_to.isoformat()


CallerDep = Annotated[db.Caller, Depends(current_caller)]
PeriodDep = Annotated[tuple[str, str], Depends(period)]


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe (no database access)."""
    return {"status": "ok"}


@app.get("/v1/kpi")
def kpis(caller: CallerDep, p: PeriodDep) -> dict[str, Any]:
    """Project and employee KPIs for the period (hours in centi-hours, money in øre, percentages in basis points)."""
    with db.tenant_cursor(caller.tenant_id) as cur:
        return {
            "from": p[0],
            "to": p[1],
            "projects": queries.project_kpis(cur, *p),
            "employees": queries.employee_kpis(cur, *p),
        }


@app.get("/v1/kpi.xlsx")
def kpis_excel(caller: CallerDep, p: PeriodDep) -> Response:
    """The KPI report as an Excel download."""
    with db.tenant_cursor(caller.tenant_id) as cur:
        projects = queries.project_kpis(cur, *p)
        employees = queries.employee_kpis(cur, *p)
    body = excel.kpi_workbook(projects, employees, *p)
    return Response(
        body,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"content-disposition": f'attachment; filename="noegletal_{p[0]}_{p[1]}.xlsx"'},
    )


@app.get("/v1/datasets/{name}")
def get_dataset(name: str, caller: CallerDep, p: PeriodDep) -> list[dict[str, Any]]:
    """A flat dataset for Power BI's Web connector or Excel's Power Query."""
    if name not in queries.DATASETS:
        raise HTTPException(status_code=404, detail="unknown_dataset")
    with db.tenant_cursor(caller.tenant_id) as cur:
        return queries.dataset(cur, name, *p, sees_reasons="finance" in caller.roles)

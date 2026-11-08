"""Read-only report queries — GRASP Pure Fabrication: SQL that gathers raw numbers; the KPI maths stays in kpi.py.

All functions take a tenant-scoped cursor (db.tenant_cursor) and a period [date_from, date_to] (inclusive ISO
dates). Hours come back as centi-hours and money as øre, so kpi.py can work on integers like the TypeScript code.
Counted hours are submitted, approved or invoiced work (drafts are still being written), as on the dashboard.
"""

from __future__ import annotations

from typing import Any

import psycopg

from . import kpi

COUNTED = ("submitted", "approved", "invoiced")


def project_kpis(cur: psycopg.Cursor, date_from: str, date_to: str) -> list[dict[str, Any]]:
    """Per project: hours, billable hours, cost, invoiced revenue and invoiced hours → billable %, rate, margin."""
    cur.execute(
        """
        with h as (
          select e.project_id,
                 round(sum(e.hours) * 100)::bigint as hours,
                 round(sum(e.hours) filter (where e.billable) * 100)::bigint as billable,
                 round(sum(e.hours * coalesce(e.cost_rate, u.cost_rate)))::bigint as cost
          from time_entries e join users u on u.id = e.user_id
          where e.project_id is not null and e.date between %(f)s and %(t)s and e.status::text = any(%(st)s)
          group by e.project_id),
        r as (
          select i.project_id, sum(i.subtotal)::bigint as revenue
          from invoices i
          where i.status = 'booked' and i.project_id is not null and i.invoice_date between %(f)s and %(t)s
          group by i.project_id),
        ih as (
          select i.project_id, round(sum(s.hours) * 100)::bigint as invoiced_hours
          from invoice_line_sources s join invoice_lines l on l.id = s.invoice_line_id join invoices i on i.id = l.invoice_id
          where i.status = 'booked' and i.type = 'invoice' and i.invoice_date between %(f)s and %(t)s
          group by i.project_id)
        select p.number, p.name, c.name as customer,
               coalesce(h.hours, 0) as hours, coalesce(h.billable, 0) as billable, coalesce(h.cost, 0) as cost,
               coalesce(r.revenue, 0) as revenue, coalesce(ih.invoiced_hours, 0) as invoiced_hours
        from projects p
        left join customers c on c.id = p.customer_id
        left join h on h.project_id = p.id
        left join r on r.project_id = p.id
        left join ih on ih.project_id = p.id
        where h.project_id is not null or r.project_id is not null
        order by p.number
        """,
        {"f": date_from, "t": date_to, "st": list(COUNTED)},
    )
    out = []
    for row in cur.fetchall():
        m, m_bp = kpi.margin(row["revenue"], row["cost"])
        out.append(
            {
                **row,
                "billable_bp": kpi.billable_pct(row["billable"], row["hours"]),
                "effective_rate": kpi.effective_rate(row["revenue"], row["invoiced_hours"]),
                "margin": m,
                "margin_bp": m_bp,
            }
        )
    return out


def employee_kpis(cur: psycopg.Cursor, date_from: str, date_to: str) -> list[dict[str, Any]]:
    """Per employee: work hours, billable hours, absence hours and billable %."""
    cur.execute(
        """
        select u.initials, u.full_name, d.name as department,
               coalesce(round(sum(e.hours) filter (where e.task_id is not null) * 100), 0)::bigint as work,
               coalesce(round(sum(e.hours) filter (where e.task_id is not null and e.billable) * 100), 0)::bigint as billable,
               coalesce(round(sum(e.hours) filter (where e.absence_code_id is not null) * 100), 0)::bigint as absence
        from users u
        left join departments d on d.id = u.department_id
        left join time_entries e on e.user_id = u.id and e.date between %(f)s and %(t)s and e.status::text = any(%(st)s)
        where u.active
        group by u.id, u.initials, u.full_name, d.name
        order by u.full_name
        """,
        {"f": date_from, "t": date_to, "st": list(COUNTED)},
    )
    return [{**r, "billable_bp": kpi.billable_pct(r["billable"], r["work"])} for r in cur.fetchall()]


DATASETS: dict[str, str] = {
    # Flat tables for Power BI / Excel. Hours as decimals and money in kroner, because that is what BI tools expect.
    "time_entries": """
        select e.date, u.initials as employee, p.number as project_number, p.name as project, t.name as task,
               a.code as absence_code, e.hours::float as hours, e.billable, e.status::text as status
        from time_entries e join users u on u.id = e.user_id
        left join projects p on p.id = e.project_id left join tasks t on t.id = e.task_id
        left join absence_codes a on a.id = e.absence_code_id
        where e.date between %(f)s and %(t)s order by e.date, u.initials""",
    "projects": """
        select p.number, p.name, c.name as customer, p.status::text as status, p.billable
        from projects p left join customers c on c.id = p.customer_id order by p.number""",
    "employees": """
        select u.initials, u.full_name, d.name as department, u.active
        from users u left join departments d on d.id = u.department_id order by u.full_name""",
    "invoices": """
        select i.number, i.type::text as type, i.invoice_date, i.due_date, c.name as customer, p.number as project_number,
               i.subtotal / 100.0 as subtotal_dkk, i.vat / 100.0 as vat_dkk
        from invoices i join customers c on c.id = i.customer_id left join projects p on p.id = i.project_id
        where i.status = 'booked' and i.invoice_date between %(f)s and %(t)s order by i.number""",
}


def dataset(cur: psycopg.Cursor, name: str, date_from: str, date_to: str) -> list[dict[str, Any]]:
    """Rows of one flat dataset (see DATASETS); raises KeyError for an unknown name."""
    cur.execute(DATASETS[name], {"f": date_from, "t": date_to})
    return cur.fetchall()

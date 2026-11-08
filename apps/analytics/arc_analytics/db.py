"""Database access for the analytics service — GRASP Pure Fabrication.

Connects as the read-only role `arc_analytics` (SELECT only, row-level security applies) and runs every query
inside a transaction with `app.tenant_id` set, exactly like withTenant() in packages/db. The caller is identified
from the web sign-in cookie via the SECURITY DEFINER function auth_get_session() — the raw token is hashed first,
as the API does, so no session secrets are stored or logged here.
"""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_URL = "postgresql://arc_analytics:arc_analytics_dev@localhost:5432/arc_tid"
UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)


def load_env() -> None:
    """Loads KEY=VALUE lines from the repo's .env into os.environ (existing variables win)."""
    env = REPO_ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def database_url() -> str:
    """The read-only connection string (ANALYTICS_DATABASE_URL, or the local development default)."""
    return os.environ.get("ANALYTICS_DATABASE_URL") or DEFAULT_URL


@dataclass(frozen=True)
class Caller:
    """The signed-in person: who, in which tenant, with which roles."""

    user_id: str
    tenant_id: str
    roles: frozenset[str]


@contextmanager
def tenant_cursor(tenant_id: str) -> Iterator[psycopg.Cursor]:
    """Yields a dict-row cursor in a read-only transaction scoped to one tenant by row-level security."""
    if not UUID_RE.match(tenant_id):
        raise ValueError("invalid tenant id")
    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("select set_config('app.tenant_id', %s, true)", (tenant_id,))
            yield cur


def caller_from_session(raw_token: str) -> Caller | None:
    """Resolves a raw session cookie to the caller (None when missing, expired or the user is inactive)."""
    if not raw_token:
        return None
    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    with psycopg.connect(database_url(), row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute("select user_id::text, tenant_id::text from auth_get_session(%s)", (digest,))
        row = cur.fetchone()
    if not row:
        return None
    with tenant_cursor(row["tenant_id"]) as cur:
        cur.execute("select role::text from user_roles where user_id = %s", (row["user_id"],))
        roles = frozenset(r["role"] for r in cur.fetchall())
    return Caller(row["user_id"], row["tenant_id"], roles)

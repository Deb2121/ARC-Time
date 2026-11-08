"""Integration tests against the local database with the read-only role. A session is obtained through the API's dev
login (http://localhost:4000), so these are skipped when the API is not running; test_kpi.py always runs."""

from __future__ import annotations

from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from arc_analytics.main import app

API = "http://localhost:4000/api/v1"
PERIOD = {"from": "2026-09-01", "to": "2026-10-31"}


def session(initials: str) -> str:
    """Raw session token for a demo user (skips the test when the API is not reachable)."""
    try:
        res = httpx.post(f"{API}/auth/dev-login", json={"email": f"{initials}@demo.arcnordic.test", "password": "demo1234"}, timeout=5)
    except httpx.HTTPError:
        pytest.skip("API not running on :4000")
    return res.cookies["arc_sid"]


@pytest.fixture
def client() -> TestClient:
    """A test client for the analytics app."""
    return TestClient(app)


def test_requires_sign_in(client: TestClient) -> None:
    assert client.get("/v1/kpi", params=PERIOD).status_code == 401


def test_employees_are_refused(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("lv"))
    assert client.get("/v1/kpi", params=PERIOD).status_code == 403


def test_finance_gets_project_kpis_that_follow_the_formulas(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("jf"))
    body = client.get("/v1/kpi", params=PERIOD).json()
    assert body["projects"], "seed has hours in September/October"
    for p in body["projects"]:
        assert p["margin"] == p["revenue"] - p["cost"]
        if p["hours"]:
            assert p["billable_bp"] == round(p["billable"] * 10_000 / p["hours"] + 1e-9)
    assert any(e["work"] > 0 for e in body["employees"])


def test_excel_export_has_the_three_sheets(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("jf"))
    res = client.get("/v1/kpi.xlsx", params=PERIOD)
    assert res.status_code == 200
    wb = load_workbook(BytesIO(res.content))
    assert wb.sheetnames == ["Projekter", "Medarbejdere", "Om"]
    assert wb["Projekter"]["A1"].value == "Projekt"


def test_power_bi_dataset_and_read_only_role(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("jf"))
    rows = client.get("/v1/datasets/time_entries", params=PERIOD).json()
    assert rows and {"date", "employee", "hours", "billable"} <= rows[0].keys()
    assert client.get("/v1/datasets/sessions", params=PERIOD).status_code == 404


def test_rejects_an_inverted_period(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("jf"))
    assert client.get("/v1/kpi", params={"from": "2026-10-31", "to": "2026-09-01"}).status_code == 400

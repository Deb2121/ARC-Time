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


def test_sickness_is_masked_for_management_but_not_finance(client: TestClient) -> None:
    client.cookies.set("arc_sid", session("kh"))  # Admin + Management, not Finance
    codes = {r["absence_code"] for r in client.get("/v1/datasets/time_entries", params=PERIOD).json()}
    assert "SYG" not in codes and "BARNSYG" not in codes
    client.cookies.set("arc_sid", session("jf"))  # Finance
    codes = {r["absence_code"] for r in client.get("/v1/datasets/time_entries", params=PERIOD).json()}
    assert "SYG" in codes and "FRAVÆR" not in codes


def test_power_bi_token_works_until_revoked() -> None:
    """D-028: Power BI sends `Authorization: Bearer arct_…`; a revoked token is refused."""
    try:
        login = httpx.post(f"{API}/auth/dev-login", json={"email": "jf@demo.arcnordic.test", "password": "demo1234"}, timeout=5)
    except httpx.HTTPError:
        pytest.skip("API not running on :4000")
    headers = {"x-csrf-token": login.json()["csrfToken"]}
    created = httpx.post(f"{API}/api-tokens", json={"name": "Power BI test"}, cookies=login.cookies, headers=headers, timeout=5).json()
    token = created["token"]
    assert token.startswith("arct_")
    client = TestClient(app)
    bearer = {"Authorization": f"Bearer {token}"}
    rows = client.get("/v1/datasets/project_kpis", params=PERIOD, headers=bearer)
    assert rows.status_code == 200
    assert rows.json() and {"project_number", "hours", "billable_share", "invoiced_dkk"} <= rows.json()[0].keys()
    assert client.get("/v1/datasets/employee_kpis", params=PERIOD, headers=bearer).status_code == 200
    httpx.delete(f"{API}/api-tokens/{created['id']}", cookies=login.cookies, headers=headers, timeout=5)
    assert client.get("/v1/datasets/projects", params=PERIOD, headers=bearer).status_code == 401
    assert client.get("/v1/datasets/projects", params=PERIOD, headers={"Authorization": "Bearer arct_unknown"}).status_code == 401

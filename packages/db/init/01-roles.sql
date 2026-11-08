-- Runtime role for the API: can read/write tables but is subject to row-level security (no BYPASSRLS, not owner).
CREATE ROLE arc_app LOGIN PASSWORD 'arc_app_dev' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE arc_tid TO arc_app;

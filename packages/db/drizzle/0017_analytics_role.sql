-- Read-only role for the Python analytics service (D-002, D-021). SELECT only, on the tables reporting needs,
-- and subject to row-level security exactly like arc_app (not owner, no BYPASSRLS): every query runs with
-- app.tenant_id set from the caller's session. The password here is for local development only; production sets
-- its own with ALTER ROLE outside migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arc_analytics') THEN
    CREATE ROLE arc_analytics LOGIN PASSWORD 'arc_analytics_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO arc_analytics', current_database()); END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO arc_analytics;
--> statement-breakpoint
GRANT SELECT ON users, user_roles, departments, customers, projects, tasks, time_entries, absence_codes,
  invoices, invoice_lines, invoice_line_sources, expenses TO arc_analytics;
--> statement-breakpoint
-- Session lookup (hash in, user/tenant out) so the service can reuse the web sign-in cookie.
GRANT EXECUTE ON FUNCTION auth_get_session(text) TO arc_analytics;

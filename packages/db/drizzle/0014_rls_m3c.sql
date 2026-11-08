-- Template for "apply RLS to every tenant table that does not have it yet".
-- Copy into a new custom migration (pnpm --filter @arc-tid/db exec drizzle-kit generate --custom --name rls_<x>)
-- after adding tables. Idempotent. The rls.test.ts guard fails if a tenant table is left without RLS.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t.relname);
  END LOOP;
END $$;
--> statement-breakpoint

-- Background jobs (e.g. weekly reminders) run outside a request, so they need the list of tenants to iterate.
-- Returns ids only; all further work happens inside withTenant() under row-level security.
CREATE OR REPLACE FUNCTION job_tenant_ids()
  RETURNS TABLE (id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT t.id FROM tenants t $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION job_tenant_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION job_tenant_ids() TO arc_app;

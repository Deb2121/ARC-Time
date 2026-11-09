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

-- Token lookup for the analytics service (D-028): hash in, owner out — only valid, unrevoked tokens of active
-- users, and it records when the token was last used. Narrow SECURITY DEFINER like auth_get_session().
CREATE OR REPLACE FUNCTION auth_use_api_token(p_token_hash text, p_scope text)
  RETURNS TABLE (user_id uuid, tenant_id uuid)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE api_tokens t SET last_used_at = now()
    FROM users u
    WHERE t.token_hash = p_token_hash AND t.scope = p_scope AND t.revoked_at IS NULL AND t.expires_at > now()
      AND u.id = t.user_id AND u.active
    RETURNING t.user_id, t.tenant_id
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_use_api_token(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_use_api_token(text, text) TO arc_analytics;

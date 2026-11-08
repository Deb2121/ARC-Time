-- Row-level security for multi-tenancy (decision D-012).
-- The API connects as role arc_app (not owner, NOBYPASSRLS) and runs `SET LOCAL app.tenant_id = '<uuid>'`
-- in every transaction. The owner role (migrations/seed) bypasses RLS because tables are not FORCEd.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_entities','departments','users','user_roles','sessions','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Privileges for the runtime role. New tables get the same default grants; RLS must still be enabled per table
-- (enforced by the test packages/db/src/rls.test.ts).
GRANT USAGE ON SCHEMA public TO arc_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arc_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arc_app;
--> statement-breakpoint

-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE ON audit_log FROM arc_app;
--> statement-breakpoint

-- Pre-authentication lookups. These run before a tenant is known, so they are narrow SECURITY DEFINER functions
-- that return only what login needs.
CREATE OR REPLACE FUNCTION auth_find_login(p_email text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_slug text, password_hash text, active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id, u.tenant_id, t.slug, u.password_hash, u.active
    FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE lower(u.email) = lower(p_email)
  $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_find_entra(p_oid text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT u.id, u.tenant_id, u.active FROM users u WHERE u.entra_object_id = p_oid $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_get_session(p_token_hash text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, csrf_token text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT s.user_id, s.tenant_id, s.csrf_token, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND u.active
  $$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION auth_find_login(text), auth_find_entra(text), auth_get_session(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_find_login(text), auth_find_entra(text), auth_get_session(text) TO arc_app;

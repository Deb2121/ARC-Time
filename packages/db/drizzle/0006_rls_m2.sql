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

-- Booked invoices are immutable (brief §4.10). Only sync bookkeeping fields may change after booking.
CREATE OR REPLACE FUNCTION forbid_booked_invoice_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'booked' THEN RAISE EXCEPTION 'booked invoice % cannot be deleted', OLD.number USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'booked' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.vat IS DISTINCT FROM OLD.vat OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.fx_rate IS DISTINCT FROM OLD.fx_rate) THEN
    RAISE EXCEPTION 'booked invoice % is immutable', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION forbid_booked_invoice_change();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_booked_line_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE id = inv AND status = 'booked') THEN
    RAISE EXCEPTION 'lines of a booked invoice are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION forbid_booked_line_change();

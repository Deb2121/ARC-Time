-- Case finance (D-029): tenant isolation for invoice_payments and invoice_reminders, plus a backfill of existing
-- payment plans. Idempotent (template: drizzle-rls-template.sql).
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
-- Existing plan items get their order from the due date.
UPDATE payment_plan_items p SET sequence = x.rn
FROM (SELECT id, row_number() OVER (PARTITION BY contract_id ORDER BY due_date, id) AS rn FROM payment_plan_items) x
WHERE x.id = p.id AND p.sequence = 0;
--> statement-breakpoint
-- A fixed-price plan that already adds up to the contract price is active; others stay draft until finance
-- completes them. A retainer's plan is its fee schedule (no 100 % rule), so it is active once it has items.
UPDATE contracts c SET plan_active = true
WHERE (c.type = 'fixed_price' AND c.price IS NOT NULL AND c.price > 0
       AND c.price = (SELECT coalesce(sum(amount), 0) FROM payment_plan_items p WHERE p.contract_id = c.id))
   OR (c.type = 'retainer' AND EXISTS (SELECT 1 FROM payment_plan_items p WHERE p.contract_id = c.id));

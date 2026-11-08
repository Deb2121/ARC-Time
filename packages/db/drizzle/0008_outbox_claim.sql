-- Outbox claiming for the delivery worker. The runtime role only sees one tenant at a time (RLS), so claiming
-- pending events across tenants goes through this narrow SECURITY DEFINER function (returns ids + tenant only).
CREATE OR REPLACE FUNCTION outbox_claim(p_limit int)
  RETURNS TABLE (id uuid, tenant_id uuid, kind text)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
  AS $$
    UPDATE outbox o SET status = 'processing', attempts = o.attempts + 1
    WHERE o.id IN (
      SELECT x.id FROM outbox x WHERE x.status = 'pending' ORDER BY x.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
    )
    RETURNING o.id, o.tenant_id, o.kind
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION outbox_claim(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION outbox_claim(int) TO arc_app;

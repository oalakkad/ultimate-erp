-- Milestone 1.4b — company hand-off (owner decision 2026-10-28).

-- Tickets are tenant-owned: RLS makes a ticket for company A invisible on company B's host.
ALTER TABLE handoff_tickets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE handoff_tickets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY handoff_tickets_isolation ON handoff_tickets TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY handoff_tickets_migrator ON handoff_tickets TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- No DELETE: used and expired tickets stay as evidence (they are hashes, not usable secrets).
GRANT SELECT, INSERT, UPDATE ON handoff_tickets TO erp_app;
--> statement-breakpoint

-- The companies a user belongs to, for the "Your companies" list on the main address.
-- Returns only what that list shows (no business data), for active memberships of active
-- companies, with their verified subdomain.
CREATE FUNCTION app.user_companies(p_user_id uuid)
  RETURNS TABLE (
    tenant_id uuid,
    slug text,
    name_en text,
    name_ar text,
    default_locale text,
    hostname text,
    roles text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name_en, t.name_ar, t.default_locale,
      (SELECT d.hostname FROM public.tenant_domains d
        WHERE d.tenant_id = t.id AND d.kind = 'subdomain' AND d.verified_at IS NOT NULL
        ORDER BY d.created_at LIMIT 1),
      ARRAY(SELECT r.role FROM public.membership_roles r
        WHERE r.tenant_id = m.tenant_id AND r.membership_id = m.id ORDER BY r.role)
    FROM public.memberships m
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.user_id = p_user_id AND m.status = 'active' AND t.status = 'active'
    ORDER BY t.name_en
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.user_companies(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.user_companies(uuid) TO erp_app;

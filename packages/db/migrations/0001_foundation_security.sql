-- Milestone 1.2 — tenant isolation (ADR-0003).
--
-- Roles are cluster-level objects created beforehand by `pnpm db:bootstrap`:
--   erp_migrator  owns the schema and tables, runs migrations (this file).
--   erp_app       used by the API and worker. Not an owner, no BYPASSRLS.
--   erp_platform  platform-operator code path: tenant directory only, no business data.
--
-- Every tenant-owned table follows the same pattern:
--   ENABLE + FORCE row level security, an isolation policy for erp_app on
--   tenant_id = app.current_tenant_id(), an explicit policy for the migrator,
--   and only the grants the app needs.

CREATE SCHEMA app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO erp_app, erp_platform;
--> statement-breakpoint

-- The tenant of the current transaction, or NULL when none is set.
-- set_config(..., true) is transaction-local and resets to '' afterwards; nullif turns
-- both "never set" and "reset" into NULL, which matches no row: the context fails closed.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tenant_domains_set_updated_at BEFORE UPDATE ON tenant_domains
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- tenants: the row itself is the tenant, so it is matched on id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_isolation ON tenants TO erp_app
  USING (id = app.current_tenant_id()) WITH CHECK (id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenants_platform_directory ON tenants FOR SELECT TO erp_platform USING (true);
--> statement-breakpoint
CREATE POLICY tenants_migrator ON tenants TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- No DELETE: companies are suspended, never deleted (domain-model.md §5).
GRANT SELECT, INSERT, UPDATE ON tenants TO erp_app;
--> statement-breakpoint
GRANT SELECT ON tenants TO erp_platform;
--> statement-breakpoint

-- tenant_domains
ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_domains FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_domains_isolation ON tenant_domains TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tenant_domains_migrator ON tenant_domains TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_domains TO erp_app;
--> statement-breakpoint

-- memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_isolation ON memberships TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY memberships_migrator ON memberships TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- No DELETE: members are marked 'removed' so history stays intact.
GRANT SELECT, INSERT, UPDATE ON memberships TO erp_app;
--> statement-breakpoint

-- users: global identity (one person, several companies), so not tenant-scoped.
-- Access goes only through the identity module; row-level rules are decided in Milestone 1.3.
GRANT SELECT, INSERT, UPDATE ON users TO erp_app;
--> statement-breakpoint

-- Host-based tenant resolution happens before any tenant context exists. This function is the
-- only way the app can look up a domain without a context: it answers one exact, verified host
-- of an active tenant with that tenant's id, and cannot be used to list domains or tenants.
CREATE FUNCTION app.resolve_tenant_by_host(p_hostname text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT d.tenant_id
    FROM public.tenant_domains d
    JOIN public.tenants t ON t.id = d.tenant_id
    WHERE d.hostname = lower(p_hostname)
      AND d.verified_at IS NOT NULL
      AND t.status = 'active'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.resolve_tenant_by_host(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_tenant_by_host(text) TO erp_app;

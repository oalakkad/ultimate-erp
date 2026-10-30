-- Phase 4 — contracts & engagement letters (docs/modules/contracts.md §3).

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contract_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contract_templates_isolation ON contract_templates TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY contract_templates_migrator ON contract_templates TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON contract_templates TO erp_app;
--> statement-breakpoint
CREATE TRIGGER contract_templates_set_updated_at BEFORE UPDATE ON contract_templates
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contracts_isolation ON contracts TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY contracts_migrator ON contracts TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Contracts are never deleted (legal record); status changes instead.
GRANT SELECT, INSERT, UPDATE ON contracts TO erp_app;
--> statement-breakpoint
CREATE TRIGGER contracts_set_updated_at BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Version history is append-only for the app.
ALTER TABLE contract_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contract_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY contract_versions_isolation ON contract_versions TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY contract_versions_migrator ON contract_versions TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON contract_versions TO erp_app;
--> statement-breakpoint

-- Scheduled jobs that work company by company need the list of active companies (IDs only),
-- then do all real work inside withTenant. No names, no business data.
CREATE FUNCTION app.active_tenant_ids()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$ SELECT id FROM public.tenants WHERE status = 'active' ORDER BY id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.active_tenant_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.active_tenant_ids() TO erp_app;

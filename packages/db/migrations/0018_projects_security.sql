-- Phase 5 — projects & budgeting (docs/modules/projects.md §4).

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY projects_isolation ON projects TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY projects_migrator ON projects TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Projects are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON projects TO erp_app;
--> statement-breakpoint
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_members_isolation ON project_members TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY project_members_migrator ON project_members TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON project_members TO erp_app;
--> statement-breakpoint

-- Budget history is append-only for the app.
ALTER TABLE project_budget_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_budget_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_budget_revisions_isolation ON project_budget_revisions TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY project_budget_revisions_migrator ON project_budget_revisions TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON project_budget_revisions TO erp_app;
--> statement-breakpoint

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_documents_isolation ON project_documents TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY project_documents_migrator ON project_documents TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON project_documents TO erp_app;

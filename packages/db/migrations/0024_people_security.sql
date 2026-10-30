-- Phase 8 — employees & teams (docs/modules/people.md §3).

-- Departments are archived, never deleted.
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY departments_isolation ON departments TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY departments_migrator ON departments TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON departments TO erp_app;
--> statement-breakpoint
CREATE TRIGGER departments_set_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Teams are archived, never deleted.
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY teams_isolation ON teams TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY teams_migrator ON teams TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON teams TO erp_app;
--> statement-breakpoint
CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY team_members_isolation ON team_members TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY team_members_migrator ON team_members TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON team_members TO erp_app;
--> statement-breakpoint

-- Employee records are never deleted (status "left" instead).
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employees_isolation ON employees TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employees_migrator ON employees TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employees TO erp_app;
--> statement-breakpoint
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Encrypted private details (the app cannot read them without DATA_ENCRYPTION_KEY).
ALTER TABLE employee_private ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_private FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_private_isolation ON employee_private TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employee_private_migrator ON employee_private TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_private TO erp_app;
--> statement-breakpoint
CREATE TRIGGER employee_private_set_updated_at BEFORE UPDATE ON employee_private
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE employee_emergency_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_emergency_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_emergency_contacts_isolation ON employee_emergency_contacts TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employee_emergency_contacts_migrator ON employee_emergency_contacts TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON employee_emergency_contacts TO erp_app;
--> statement-breakpoint

-- Employment history is append-only for the app.
ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_history_isolation ON employee_history TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employee_history_migrator ON employee_history TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON employee_history TO erp_app;
--> statement-breakpoint

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_documents_isolation ON employee_documents TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employee_documents_migrator ON employee_documents TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON employee_documents TO erp_app;
--> statement-breakpoint

ALTER TABLE employee_checklist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE employee_checklist_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY employee_checklist_items_isolation ON employee_checklist_items TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY employee_checklist_items_migrator ON employee_checklist_items TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON employee_checklist_items TO erp_app;

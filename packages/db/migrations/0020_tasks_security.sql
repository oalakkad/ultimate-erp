-- Phase 6 — tasks & hour allocation (docs/modules/tasks.md §4).

-- Tasks are cancelled, never deleted.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tasks_isolation ON tasks TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY tasks_migrator ON tasks TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tasks TO erp_app;
--> statement-breakpoint
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE task_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_allocations_isolation ON task_allocations TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY task_allocations_migrator ON task_allocations TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON task_allocations TO erp_app;
--> statement-breakpoint
CREATE TRIGGER task_allocations_set_updated_at BEFORE UPDATE ON task_allocations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_dependencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_dependencies_isolation ON task_dependencies TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY task_dependencies_migrator ON task_dependencies TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON task_dependencies TO erp_app;
--> statement-breakpoint

-- Comments are append-only for the app.
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_comments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_comments_isolation ON task_comments TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY task_comments_migrator ON task_comments TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON task_comments TO erp_app;
--> statement-breakpoint

ALTER TABLE task_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY task_documents_isolation ON task_documents TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY task_documents_migrator ON task_documents TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON task_documents TO erp_app;

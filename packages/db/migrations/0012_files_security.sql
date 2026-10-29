-- Milestone 1.5b — files (docs/modules/files-monitoring.md §2).

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY files_isolation ON files TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY files_migrator ON files TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Content facts are fixed at upload; only the scan outcome may change. No DELETE (retention
-- is decided per module; infected objects are removed from storage, the record stays).
GRANT SELECT, INSERT, UPDATE (status, scanned_at) ON files TO erp_app;

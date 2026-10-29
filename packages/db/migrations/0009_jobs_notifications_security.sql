-- Milestone 1.5a — background jobs and notifications (docs/modules/platform-jobs.md).
-- The pg-boss queue itself (schema pgboss) is installed by the migration runner (jobs.ts).

-- Notifications are tenant-owned: RLS limits every query to the current company; the service
-- additionally limits each person to their own rows.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_isolation ON notifications TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY notifications_migrator ON notifications TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- No DELETE: read notifications stay (retention policy decided with Module L, Phase 13).
GRANT SELECT, INSERT, UPDATE (read_at) ON notifications TO erp_app;
--> statement-breakpoint

-- Email delivery status: global (account emails belong to no company), no content stored.
GRANT SELECT, INSERT, UPDATE (status, attempts, last_error_code, sent_at) ON email_deliveries TO erp_app;
--> statement-breakpoint
CREATE TRIGGER email_deliveries_set_updated_at BEFORE UPDATE ON email_deliveries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

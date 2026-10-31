-- Phase 13 — notification preferences and announcements (docs/modules/notifications.md §3).

-- Each person's own notification choices (the API only touches the caller's rows).
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_isolation ON notification_preferences TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY notification_preferences_migrator ON notification_preferences TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO erp_app;
--> statement-breakpoint

-- Announcements are permanent once published.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY announcements_isolation ON announcements TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY announcements_migrator ON announcements TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON announcements TO erp_app;
--> statement-breakpoint

ALTER TABLE announcement_emails ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE announcement_emails FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY announcement_emails_isolation ON announcement_emails TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY announcement_emails_migrator ON announcement_emails TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON announcement_emails TO erp_app;

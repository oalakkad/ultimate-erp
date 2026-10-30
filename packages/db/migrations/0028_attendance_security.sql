-- Phase 10 — attendance (docs/modules/attendance.md §3).

-- Company settings by key.
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE company_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY company_settings_isolation ON company_settings TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY company_settings_migrator ON company_settings TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON company_settings TO erp_app;
--> statement-breakpoint
CREATE TRIGGER company_settings_set_updated_at BEFORE UPDATE ON company_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Sites are archived, never deleted.
ALTER TABLE attendance_sites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_sites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_sites_isolation ON attendance_sites TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY attendance_sites_migrator ON attendance_sites TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_sites TO erp_app;
--> statement-breakpoint
CREATE TRIGGER attendance_sites_set_updated_at BEFORE UPDATE ON attendance_sites
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Shifts are archived, never deleted.
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shifts_isolation ON shifts TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY shifts_migrator ON shifts TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON shifts TO erp_app;
--> statement-breakpoint
CREATE TRIGGER shifts_set_updated_at BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shift_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shift_assignments_isolation ON shift_assignments TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY shift_assignments_migrator ON shift_assignments TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_assignments TO erp_app;
--> statement-breakpoint
CREATE TRIGGER shift_assignments_set_updated_at BEFORE UPDATE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Corrections are decided, never deleted.
ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_corrections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_corrections_isolation ON attendance_corrections TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY attendance_corrections_migrator ON attendance_corrections TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON attendance_corrections TO erp_app;
--> statement-breakpoint

-- Attendance events are append-only for the app (auditable record).
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_events_isolation ON attendance_events TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY attendance_events_migrator ON attendance_events TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_events TO erp_app;
--> statement-breakpoint

-- Replay protection: one use of a kiosk code per person and window.
ALTER TABLE attendance_code_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE attendance_code_uses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY attendance_code_uses_isolation ON attendance_code_uses TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY attendance_code_uses_migrator ON attendance_code_uses TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON attendance_code_uses TO erp_app;
--> statement-breakpoint

-- Nobody decides on their own attendance correction.
CREATE FUNCTION app.attendance_corrections_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  owner_user uuid;
BEGIN
  IF NEW.decided_by_user_id IS NOT NULL THEN
    SELECT user_id INTO owner_user FROM public.memberships WHERE tenant_id = NEW.tenant_id AND id = NEW.membership_id;
    IF owner_user = NEW.decided_by_user_id THEN
      RAISE EXCEPTION 'nobody decides on their own attendance correction' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER attendance_corrections_guard BEFORE INSERT OR UPDATE ON attendance_corrections
  FOR EACH ROW EXECUTE FUNCTION app.attendance_corrections_guard();

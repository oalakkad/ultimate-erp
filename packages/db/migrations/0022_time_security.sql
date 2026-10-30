-- Phase 7 — timesheets & time tracking (docs/modules/timesheets.md §4).

-- Timesheets are never deleted.
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE timesheets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY timesheets_isolation ON timesheets TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY timesheets_migrator ON timesheets TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON timesheets TO erp_app;
--> statement-breakpoint
CREATE TRIGGER timesheets_set_updated_at BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Only draft or rejected entries are deleted (enforced by the API and the trigger below).
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_entries_isolation ON time_entries TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY time_entries_migrator ON time_entries TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO erp_app;
--> statement-breakpoint
CREATE TRIGGER time_entries_set_updated_at BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- One running timer per person.
ALTER TABLE time_timers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE time_timers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY time_timers_isolation ON time_timers TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY time_timers_migrator ON time_timers TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON time_timers TO erp_app;
--> statement-breakpoint

-- An entry's date lies inside its timesheet's week; nobody decides on their own time; approved
-- entries are not deleted. Runs as the calling role, so row-level security still applies.
CREATE FUNCTION app.time_entries_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  week date;
  owner_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'time entry % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  SELECT week_start INTO week FROM public.timesheets WHERE tenant_id = NEW.tenant_id AND id = NEW.timesheet_id;
  IF NEW.work_date < week OR NEW.work_date > week + 6 THEN
    RAISE EXCEPTION 'work date % is outside the timesheet week %', NEW.work_date, week USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.decided_by_user_id IS NOT NULL THEN
    SELECT user_id INTO owner_user FROM public.memberships WHERE tenant_id = NEW.tenant_id AND id = NEW.membership_id;
    IF owner_user = NEW.decided_by_user_id THEN
      RAISE EXCEPTION 'nobody approves or rejects their own time' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER time_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION app.time_entries_guard();

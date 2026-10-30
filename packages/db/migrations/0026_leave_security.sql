-- Phase 9 — leave management (docs/modules/leave.md §3).

-- Leave types are archived, never deleted.
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_types FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leave_types_isolation ON leave_types TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY leave_types_migrator ON leave_types TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON leave_types TO erp_app;
--> statement-breakpoint
CREATE TRIGGER leave_types_set_updated_at BEFORE UPDATE ON leave_types
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public_holidays FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY public_holidays_isolation ON public_holidays TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY public_holidays_migrator ON public_holidays TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public_holidays TO erp_app;
--> statement-breakpoint

-- Requests are never deleted; they end withdrawn, rejected or cancelled.
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leave_requests_isolation ON leave_requests TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY leave_requests_migrator ON leave_requests TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON leave_requests TO erp_app;
--> statement-breakpoint
CREATE TRIGGER leave_requests_set_updated_at BEFORE UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- The balance ledger is append-only for the app.
ALTER TABLE leave_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE leave_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY leave_ledger_isolation ON leave_ledger TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY leave_ledger_migrator ON leave_ledger TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON leave_ledger TO erp_app;
--> statement-breakpoint

-- Nobody approves, rejects or cancels-as-approver their own leave.
CREATE FUNCTION app.leave_requests_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  owner_user uuid;
BEGIN
  IF NEW.decided_by_user_id IS NOT NULL AND NEW.status IN ('approved', 'rejected') THEN
    SELECT user_id INTO owner_user FROM public.memberships WHERE tenant_id = NEW.tenant_id AND id = NEW.membership_id;
    IF owner_user = NEW.decided_by_user_id THEN
      RAISE EXCEPTION 'nobody decides on their own leave' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER leave_requests_guard BEFORE INSERT OR UPDATE ON leave_requests
  FOR EACH ROW EXECUTE FUNCTION app.leave_requests_guard();

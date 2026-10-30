-- Phase 11 — payroll (docs/modules/payroll.md §2, §4).

-- Rule sets are versions: never edited, except confirming verification (column grant below).
ALTER TABLE payroll_rule_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_rule_sets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_rule_sets_isolation ON payroll_rule_sets TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY payroll_rule_sets_migrator ON payroll_rule_sets TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON payroll_rule_sets TO erp_app;
--> statement-breakpoint

-- Salary history is append-only: a change is a new record with its effective date.
ALTER TABLE salary_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE salary_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY salary_records_isolation ON salary_records TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY salary_records_migrator ON salary_records TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON salary_records TO erp_app;
--> statement-breakpoint

-- Runs are cancelled, never deleted.
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_runs_isolation ON payroll_runs TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY payroll_runs_migrator ON payroll_runs TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payroll_runs TO erp_app;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_set_updated_at BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE payroll_inputs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payroll_inputs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payroll_inputs_isolation ON payroll_inputs TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY payroll_inputs_migrator ON payroll_inputs TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON payroll_inputs TO erp_app;
--> statement-breakpoint

-- Payslips are replaced only while the run is being prepared (trigger below).
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payslips_isolation ON payslips TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY payslips_migrator ON payslips TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON payslips TO erp_app;
--> statement-breakpoint

GRANT UPDATE (to_verify) ON payroll_rule_sets TO erp_app;
--> statement-breakpoint

-- Payslips and inputs change only while the run is being prepared.
CREATE FUNCTION app.payroll_prepared_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  run_status text;
  row_run uuid;
  row_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN row_run := OLD.run_id; row_tenant := OLD.tenant_id; ELSE row_run := NEW.run_id; row_tenant := NEW.tenant_id; END IF;
  SELECT status INTO run_status FROM public.payroll_runs WHERE tenant_id = row_tenant AND id = row_run;
  IF run_status NOT IN ('draft', 'calculated') THEN
    RAISE EXCEPTION 'payroll run is % and can no longer change', run_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payslips_prepared_only BEFORE INSERT OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION app.payroll_prepared_only();
--> statement-breakpoint
CREATE TRIGGER payroll_inputs_prepared_only BEFORE INSERT OR DELETE ON payroll_inputs
  FOR EACH ROW EXECUTE FUNCTION app.payroll_prepared_only();
--> statement-breakpoint

-- Real payment needs a verified rule set; status only moves forward once paid.
CREATE FUNCTION app.payroll_runs_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  unverified boolean;
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'a paid payroll run cannot change status' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'paid' AND OLD.status <> 'paid' THEN
    SELECT to_verify INTO unverified FROM public.payroll_rule_sets WHERE tenant_id = NEW.tenant_id AND id = NEW.rule_set_id;
    IF unverified IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'payroll rules are not verified; a test run cannot be paid' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER payroll_runs_guard BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION app.payroll_runs_guard();

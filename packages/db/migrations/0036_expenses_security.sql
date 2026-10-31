-- Phase 12b — expenses (docs/modules/expenses.md §3–§4).

-- Drafts may be deleted; submitted, approved and reimbursed claims stay (trigger below).
ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expense_claims FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expense_claims_isolation ON expense_claims TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY expense_claims_migrator ON expense_claims TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_claims TO erp_app;
--> statement-breakpoint
CREATE TRIGGER expense_claims_set_updated_at BEFORE UPDATE ON expense_claims
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE expense_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE expense_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY expense_lines_isolation ON expense_lines TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY expense_lines_migrator ON expense_lines TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_lines TO erp_app;
--> statement-breakpoint

ALTER TABLE invoice_expense_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_expense_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_expense_lines_isolation ON invoice_expense_lines TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY invoice_expense_lines_migrator ON invoice_expense_lines TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON invoice_expense_lines TO erp_app;
--> statement-breakpoint

-- Claim state rules the database itself enforces.
CREATE FUNCTION app.expense_claims_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'expense claim % is % and cannot be deleted', OLD.number, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.membership_id <> OLD.membership_id THEN
    RAISE EXCEPTION 'an expense claim cannot change hands' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number THEN
    RAISE EXCEPTION 'an expense claim keeps its number' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft' AND NEW.status = 'submitted')
    OR (OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'rejected' AND NEW.status = 'draft')
    OR (OLD.status = 'approved' AND NEW.status = 'reimbursed')
  ) THEN
    RAISE EXCEPTION 'expense claim cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND NEW.total <> OLD.total THEN
    RAISE EXCEPTION 'the total of a submitted claim is fixed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER expense_claims_guard BEFORE UPDATE OR DELETE ON expense_claims
  FOR EACH ROW EXECUTE FUNCTION app.expense_claims_guard();
--> statement-breakpoint

-- Lines change only while their claim is a draft.
CREATE FUNCTION app.expense_lines_draft_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  claim_status text;
BEGIN
  SELECT status INTO claim_status FROM public.expense_claims
    WHERE tenant_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END)
      AND id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.claim_id ELSE NEW.claim_id END);
  -- Cascade from deleting a draft finds no claim row any more: allowed.
  IF claim_status IS NOT NULL AND claim_status <> 'draft' THEN
    RAISE EXCEPTION 'expense claim is % and its lines are fixed', claim_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER expense_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON expense_lines
  FOR EACH ROW EXECUTE FUNCTION app.expense_lines_draft_only();
--> statement-breakpoint

-- Only approved (or reimbursed) billable lines can be re-billed.
CREATE FUNCTION app.invoice_expense_lines_approved_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_lines l
      JOIN public.expense_claims c ON c.tenant_id = l.tenant_id AND c.id = l.claim_id
    WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.expense_line_id
      AND l.billable AND c.status IN ('approved', 'reimbursed')
  ) THEN
    RAISE EXCEPTION 'only approved billable expenses can be invoiced' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_expense_lines_approved_only BEFORE INSERT ON invoice_expense_lines
  FOR EACH ROW EXECUTE FUNCTION app.invoice_expense_lines_approved_only();
--> statement-breakpoint

-- Re-billed expenses follow the invoice's draft rule; voiding releases them, like billed time.
CREATE OR REPLACE FUNCTION app.invoice_draft_only() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  inv_status text;
  inv uuid;
  tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN inv := OLD.invoice_id; tenant := OLD.tenant_id; ELSE inv := NEW.invoice_id; tenant := NEW.tenant_id; END IF;
  SELECT status INTO inv_status FROM public.invoices WHERE tenant_id = tenant AND id = inv;
  -- Voiding an invoice releases its billed time and expenses so they can be invoiced again.
  IF TG_TABLE_NAME IN ('invoice_time_entries', 'invoice_expense_lines') AND TG_OP = 'DELETE' AND inv_status = 'void' THEN
    RETURN OLD;
  END IF;
  -- Cascade from deleting a draft finds no invoice row any more: allowed.
  IF inv_status IS NOT NULL AND inv_status <> 'draft' THEN
    RAISE EXCEPTION 'invoice is % and its lines are fixed', inv_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_expense_lines_draft_only BEFORE INSERT OR DELETE ON invoice_expense_lines
  FOR EACH ROW EXECUTE FUNCTION app.invoice_draft_only();

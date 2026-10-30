-- Phase 12 — invoicing & payments (docs/modules/billing.md §4).

-- Only drafts may be deleted (trigger below); issued invoices are corrected by void or credit note.
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_isolation ON invoices TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY invoices_migrator ON invoices TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO erp_app;
--> statement-breakpoint
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Lines change only while the invoice is a draft (trigger below).
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_lines_isolation ON invoice_lines TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY invoice_lines_migrator ON invoice_lines TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_lines TO erp_app;
--> statement-breakpoint

ALTER TABLE invoice_time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_time_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_time_entries_isolation ON invoice_time_entries TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY invoice_time_entries_migrator ON invoice_time_entries TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON invoice_time_entries TO erp_app;
--> statement-breakpoint

-- Payments are never deleted or edited; a mistake is reversed with a reason (column grant below).
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payments_isolation ON payments TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY payments_migrator ON payments TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON payments TO erp_app;
--> statement-breakpoint

-- Credit notes are permanent.
ALTER TABLE credit_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_notes_isolation ON credit_notes TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY credit_notes_migrator ON credit_notes TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON credit_notes TO erp_app;
--> statement-breakpoint

GRANT UPDATE (status, reverse_reason) ON payments TO erp_app;
--> statement-breakpoint

-- Invoice state rules the database itself enforces.
CREATE FUNCTION app.invoices_guard() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'issued invoice % cannot be deleted', OLD.number USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'an issued invoice cannot return to draft' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'void' AND NEW.status <> 'void' THEN
    RAISE EXCEPTION 'a void invoice stays void' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.total <> OLD.total OR NEW.client_id <> OLD.client_id OR NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'issued invoice amounts, client and number are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' AND EXISTS (
    SELECT 1 FROM public.payments p WHERE p.tenant_id = NEW.tenant_id AND p.invoice_id = NEW.id AND p.status = 'recorded'
  ) THEN
    RAISE EXCEPTION 'an invoice with payments cannot be voided; issue a credit note' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoices_guard();
--> statement-breakpoint

CREATE FUNCTION app.invoice_draft_only() RETURNS trigger
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
  -- Voiding an invoice releases its billed time so it can be invoiced again.
  IF TG_TABLE_NAME = 'invoice_time_entries' AND TG_OP = 'DELETE' AND inv_status = 'void' THEN
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
CREATE TRIGGER invoice_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION app.invoice_draft_only();
--> statement-breakpoint
CREATE TRIGGER invoice_time_entries_draft_only BEFORE INSERT OR DELETE ON invoice_time_entries
  FOR EACH ROW EXECUTE FUNCTION app.invoice_draft_only();

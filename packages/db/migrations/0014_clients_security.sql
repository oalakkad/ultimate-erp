-- Phase 3 — clients / CRM (docs/modules/clients.md §3, §6).

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clients_isolation ON clients TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY clients_migrator ON clients TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Clients are archived, never deleted (domain-model.md: master data with history).
GRANT SELECT, INSERT, UPDATE ON clients TO erp_app;
--> statement-breakpoint
CREATE TRIGGER clients_set_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY client_contacts_isolation ON client_contacts TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY client_contacts_migrator ON client_contacts TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON client_contacts TO erp_app;
--> statement-breakpoint
CREATE TRIGGER client_contacts_set_updated_at BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Communication history is append-only for the app: no UPDATE, no DELETE.
ALTER TABLE client_interactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_interactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY client_interactions_isolation ON client_interactions TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY client_interactions_migrator ON client_interactions TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON client_interactions TO erp_app;
--> statement-breakpoint

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY client_documents_isolation ON client_documents TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY client_documents_migrator ON client_documents TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Detaching a document removes only the link (the file record stays for the audit trail).
GRANT SELECT, INSERT, DELETE ON client_documents TO erp_app;
--> statement-breakpoint

ALTER TABLE number_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE number_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY number_sequences_isolation ON number_sequences TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY number_sequences_migrator ON number_sequences TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (next_value) ON number_sequences TO erp_app;

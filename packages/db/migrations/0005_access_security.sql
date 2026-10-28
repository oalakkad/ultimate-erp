-- Milestone 1.3b — access module (docs/modules/access.md §4). Same tenant pattern as 0001:
-- ENABLE + FORCE RLS, isolation policy for erp_app, explicit migrator policy, minimum grants.

ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_roles_isolation ON membership_roles TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY membership_roles_migrator ON membership_roles TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- DELETE is needed to replace a member's roles; every change is audited.
GRANT SELECT, INSERT, DELETE ON membership_roles TO erp_app;
--> statement-breakpoint

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_isolation ON invitations TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY invitations_migrator ON invitations TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- No DELETE: revoked/accepted invitations stay as history.
GRANT SELECT, INSERT, UPDATE ON invitations TO erp_app;
--> statement-breakpoint
CREATE TRIGGER invitations_set_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_isolation ON audit_events TO erp_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY audit_events_migrator ON audit_events TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Append-only (security.md §2): the app may only add and read.
GRANT SELECT, INSERT ON audit_events TO erp_app;
--> statement-breakpoint
-- ...and nobody, including the table owner, may change or remove an entry. Only a superuser
-- disabling the trigger could, which is itself visible in the database logs.
CREATE FUNCTION app.reject_audit_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '42501'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_audit_change();
--> statement-breakpoint

-- Role names a user holds across all their active memberships, with no tenant information.
-- Used only to refuse "trust this device" for users with sensitive roles anywhere.
CREATE FUNCTION app.user_role_names(p_user_id uuid) RETURNS SETOF text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT DISTINCT r.role
    FROM public.membership_roles r
    JOIN public.memberships m ON m.tenant_id = r.tenant_id AND m.id = r.membership_id
    WHERE m.user_id = p_user_id AND m.status = 'active'
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.user_role_names(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.user_role_names(uuid) TO erp_app;

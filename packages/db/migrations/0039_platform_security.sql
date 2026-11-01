-- Phase 17 — platform console (docs/modules/platform.md §3–§4).
-- Global tables: no tenant_id. The app may read who the operators are and append to the
-- platform audit; granting an operator is reserved to the migrator (the command-line tool).

ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_operators FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_operators_read ON platform_operators FOR SELECT TO erp_app USING (true);
--> statement-breakpoint
CREATE POLICY platform_operators_migrator ON platform_operators TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON platform_operators TO erp_app;
--> statement-breakpoint

ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_audit_events_app ON platform_audit_events TO erp_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY platform_audit_events_migrator ON platform_audit_events TO erp_migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON platform_audit_events TO erp_app;
--> statement-breakpoint
CREATE TRIGGER platform_audit_events_append_only BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_change();
--> statement-breakpoint
CREATE TRIGGER platform_audit_events_no_truncate BEFORE TRUNCATE ON platform_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_audit_change();
--> statement-breakpoint

-- True when the user is a platform operator. Every platform function checks this itself, so a
-- misuse of the functions from application code still yields nothing for a non-operator.
CREATE FUNCTION app.is_platform_operator(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM public.platform_operators o WHERE o.user_id = p_user_id)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_platform_operator(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_platform_operator(uuid) TO erp_app;
--> statement-breakpoint

-- The company directory for the console: identity of each company, its size and when it was
-- last active. Deliberately no business data (no clients, invoices, hours, documents, salaries).
CREATE FUNCTION app.platform_companies(p_user_id uuid)
  RETURNS TABLE (
    tenant_id uuid,
    slug text,
    name_en text,
    name_ar text,
    status text,
    default_locale text,
    created_at timestamptz,
    hostname text,
    active_members integer,
    pending_invitations integer,
    owners jsonb,
    last_activity_at timestamptz,
    files_bytes bigint
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t.id, t.slug, t.name_en, t.name_ar, t.status, t.default_locale, t.created_at,
      (SELECT d.hostname FROM public.tenant_domains d
        WHERE d.tenant_id = t.id AND d.kind = 'subdomain' AND d.verified_at IS NOT NULL
        ORDER BY d.created_at LIMIT 1),
      (SELECT count(*)::int FROM public.memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
      (SELECT count(*)::int FROM public.invitations i
        WHERE i.tenant_id = t.id AND i.status = 'pending' AND i.expires_at > now()),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email) ORDER BY u.name)
        FROM public.memberships m
        JOIN public.membership_roles r ON r.tenant_id = m.tenant_id AND r.membership_id = m.id AND r.role = 'owner'
        JOIN public.users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.status = 'active'), '[]'::jsonb),
      (SELECT max(a.occurred_at) FROM public.audit_events a WHERE a.tenant_id = t.id),
      COALESCE((SELECT sum(f.size_bytes) FROM public.files f WHERE f.tenant_id = t.id), 0)::bigint
    FROM public.tenants t
    WHERE app.is_platform_operator(p_user_id)
    ORDER BY t.created_at DESC
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_companies(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_companies(uuid) TO erp_app;
--> statement-breakpoint

-- Whole-installation numbers for the console's overview.
CREATE FUNCTION app.platform_overview(p_user_id uuid)
  RETURNS TABLE (
    companies integer,
    companies_active integer,
    companies_suspended integer,
    companies_new_30d integer,
    people integer,
    accounts integer,
    sign_ins_7d integer,
    files_bytes bigint
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      (SELECT count(*)::int FROM public.tenants),
      (SELECT count(*)::int FROM public.tenants WHERE status = 'active'),
      (SELECT count(*)::int FROM public.tenants WHERE status = 'suspended'),
      (SELECT count(*)::int FROM public.tenants WHERE created_at > now() - interval '30 days'),
      (SELECT count(*)::int FROM public.memberships WHERE status = 'active'),
      (SELECT count(*)::int FROM public.users),
      (SELECT count(*)::int FROM public.sessions WHERE created_at > now() - interval '7 days'),
      (SELECT COALESCE(sum(size_bytes), 0)::bigint FROM public.files)
    WHERE app.is_platform_operator(p_user_id)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_overview(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_overview(uuid) TO erp_app;
--> statement-breakpoint

-- Suspend or reactivate a company. A suspended company's addresses stop resolving at once
-- (app.resolve_tenant_by_host needs status = 'active'), and it disappears from its members'
-- company lists. Returns the previous status, or null when the caller is not an operator or
-- the company does not exist.
CREATE FUNCTION app.platform_set_company_status(p_user_id uuid, p_tenant_id uuid, p_status text)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE previous text;
  BEGIN
    IF NOT app.is_platform_operator(p_user_id) THEN RETURN NULL; END IF;
    IF p_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
    UPDATE public.tenants SET status = p_status WHERE id = p_tenant_id AND status <> p_status
      RETURNING (SELECT status FROM public.tenants WHERE id = p_tenant_id) INTO previous;
    IF previous IS NULL THEN
      SELECT status INTO previous FROM public.tenants WHERE id = p_tenant_id;
    END IF;
    RETURN previous;
  END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.platform_set_company_status(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.platform_set_company_status(uuid, uuid, text) TO erp_app;
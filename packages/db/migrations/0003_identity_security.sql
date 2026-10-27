-- Milestone 1.3a — identity tables (docs/modules/identity.md §3).
-- These tables are GLOBAL on purpose (sign-in happens before any company is known), so they
-- have no row-level security. They are listed in the catalog guard's allow-list of global
-- tables; only the identity module may use them (lint rule). erp_platform gets nothing.
-- Least privilege: no DELETE where records are kept (users, accounts, known devices).

GRANT SELECT, INSERT, UPDATE ON accounts TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON verifications TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON two_factors TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON used_totp_codes TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON user_known_devices TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_buckets TO erp_app;
--> statement-breakpoint

CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER verifications_set_updated_at BEFORE UPDATE ON verifications
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

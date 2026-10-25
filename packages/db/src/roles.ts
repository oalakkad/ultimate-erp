/** Database roles (ADR-0003). Names are fixed because migrations grant to them. */
export const DB_ROLES = {
  /** Owns schema and tables; runs migrations only. */
  migrator: 'erp_migrator',
  /** Used by API and worker; subject to row-level security. */
  app: 'erp_app',
  /** Platform-operator code path: tenant directory only. No login until that code exists. */
  platform: 'erp_platform',
} as const;

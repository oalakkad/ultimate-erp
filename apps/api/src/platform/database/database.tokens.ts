/** The raw pg pool. Only platform code (health checks, DatabaseModule) may inject it. */
export const DB_POOL = Symbol('DB_POOL');

/** The Drizzle handle without tenant context. Only TenantDatabase and the role check use it. */
export const DB = Symbol('DB');

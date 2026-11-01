import pg from 'pg';

/**
 * Grants (or revokes) the platform console to an existing account (docs/modules/platform.md §4).
 * Runs as the migrator role from the command line on the server — there is deliberately no API
 * for this, so nobody can promote themselves through the application.
 */
export async function grantFounder(
  migratorUrl: string,
  email: string,
  revoke = false,
): Promise<'granted' | 'already' | 'revoked' | 'not_operator' | 'no_account'> {
  const client = new pg.Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    const user = await client.query<{ id: string }>(
      'select id from users where lower(email) = lower($1)',
      [email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) return 'no_account';
    if (revoke) {
      const removed = await client.query('delete from platform_operators where user_id = $1', [
        userId,
      ]);
      return removed.rowCount ? 'revoked' : 'not_operator';
    }
    const inserted = await client.query(
      `insert into platform_operators (user_id, role, granted_by) values ($1, 'founder', 'cli')
       on conflict (user_id) do nothing`,
      [userId],
    );
    return inserted.rowCount ? 'granted' : 'already';
  } finally {
    await client.end();
  }
}

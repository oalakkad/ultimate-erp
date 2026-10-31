import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { type Database, users } from '@ultimate-erp/db';
import { inArray } from 'drizzle-orm';
import { DB } from '../../platform/database/database.tokens.js';

export interface UserContact {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  locale: 'en' | 'ar';
}

/**
 * The narrow, read-only view of accounts that platform code (the notifier's email copies)
 * needs: name, address and language. Kept in the identity module, which owns the global
 * account tables (docs/modules/identity.md §3).
 */
@Injectable()
export class UserDirectory {
  constructor(@Inject(DB) private readonly db: Database) {}

  async contacts(userIds: readonly string[]): Promise<UserContact[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        locale: users.locale,
      })
      .from(users)
      .where(inArray(users.id, [...userIds]));
  }
}

@Global()
@Module({ providers: [UserDirectory], exports: [UserDirectory] })
export class UserDirectoryModule {}

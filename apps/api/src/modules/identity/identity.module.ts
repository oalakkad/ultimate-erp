import { Module } from '@nestjs/common';
import { type Database } from '@ultimate-erp/db';
import { PinoLogger } from 'nestjs-pino';
import { type AppConfig } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { DB } from '../../platform/database/database.tokens.js';
import { AUTH, createAuth } from './auth.js';
import { AuthController } from './auth.controller.js';
import { BREACH_FETCH, BreachedPasswordChecker } from './breached-password.js';
import { IdentityEmails } from './identity-emails.js';
import { IdentityService } from './identity.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionsController } from './sessions.controller.js';
import { TwoFactorController } from './two-factor.controller.js';

@Module({
  controllers: [AuthController, TwoFactorController, SessionsController],
  providers: [
    IdentityEmails,
    {
      provide: AUTH,
      inject: [DB, APP_CONFIG, IdentityEmails, PinoLogger],
      useFactory: (db: Database, config: AppConfig, emails: IdentityEmails, logger: PinoLogger) => {
        logger.setContext('BetterAuth');
        return createAuth({ db, config, emails, logger });
      },
    },
    { provide: BREACH_FETCH, useValue: globalThis.fetch },
    BreachedPasswordChecker,
    IdentityService,
    SessionGuard,
  ],
  exports: [IdentityService, SessionGuard],
})
export class IdentityModule {}

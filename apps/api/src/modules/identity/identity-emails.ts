import { Inject, Injectable } from '@nestjs/common';
import { type Locale } from '@ultimate-erp/i18n';
import { type AppConfig, webPublicUrl } from '../../platform/config/config.js';
import { APP_CONFIG } from '../../platform/config/config.module.js';
import { type EmailTemplate, Mailer } from '../../platform/mail/mailer.js';

/** The subset of a user that emails need. */
export interface EmailRecipient {
  email: string;
  name: string;
  locale?: string | null;
}

const localeOf = (user: EmailRecipient): Locale => (user.locale === 'ar' ? 'ar' : 'en');

/** Every email the identity module sends, in the recipient's language. */
@Injectable()
export class IdentityEmails {
  constructor(
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  verifyEmail(user: EmailRecipient, token: string): Promise<void> {
    return this.send(user, 'verifyEmail', {
      url: this.link('/verify-email', token),
    });
  }

  resetPassword(user: EmailRecipient, token: string): Promise<void> {
    // Opens the web app's reset page, which checks the link via GET /api/v1/auth/password/reset.
    return this.send(user, 'resetPassword', {
      url: this.link('/reset-password', token),
    });
  }

  existingAccount(user: EmailRecipient): Promise<void> {
    return this.send(user, 'existingAccount', {});
  }

  passwordChanged(user: EmailRecipient): Promise<void> {
    return this.send(user, 'passwordChanged', {});
  }

  accountLocked(user: EmailRecipient): Promise<void> {
    return this.send(user, 'accountLocked', {});
  }

  newDevice(user: EmailRecipient, details: { device: string; ip: string; time: string }) {
    return this.send(user, 'newDevice', details);
  }

  twoFactorEnabled(user: EmailRecipient): Promise<void> {
    return this.send(user, 'twoFactorEnabled', {});
  }

  twoFactorDisabled(user: EmailRecipient): Promise<void> {
    return this.send(user, 'twoFactorDisabled', {});
  }

  private link(path: string, token: string): string {
    const url = new URL(path, webPublicUrl(this.config));
    url.searchParams.set('token', token);
    return url.toString();
  }

  private send(user: EmailRecipient, template: EmailTemplate, params: Record<string, string>) {
    return this.mailer.send({
      to: user.email,
      locale: localeOf(user),
      template,
      params: { name: user.name, ...params },
    });
  }
}

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { catalogs, DIRECTION, format, type Locale } from '@ultimate-erp/i18n';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import nodemailer, { type Transporter } from 'nodemailer';
import { type AppConfig } from '../config/config.js';
import { APP_CONFIG } from '../config/config.module.js';

type EmailTemplates = (typeof catalogs)['en']['email'];
/** Keys of templates that have a subject and a body. */
export type EmailTemplate = {
  [K in keyof EmailTemplates]: EmailTemplates[K] extends { subject: string } ? K : never;
}[keyof EmailTemplates];

export interface EmailMessage {
  to: string;
  locale: Locale;
  template: EmailTemplate;
  params: Record<string, string>;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * HTML version of a plain-text email: escaped, links clickable, right-to-left for Arabic.
 * Only our own http(s) URLs appear in templates; everything else stays inert text.
 */
export function renderHtml(text: string, locale: Locale): string {
  const body = escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return (
    `<!doctype html><html lang="${locale}" dir="${DIRECTION[locale]}"><body>` +
    `<div style="font-family:sans-serif;white-space:pre-wrap;text-align:start">${body}</div>` +
    `</body></html>`
  );
}

/**
 * Sends transactional email over SMTP (Mailpit in development) in the recipient's language.
 * Delivery is synchronous for now; Milestone 1.5 moves it to the outbox with retries and
 * delivery status (tracked in project-status known issues).
 */
@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport: Transporter;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectPinoLogger(Mailer.name) private readonly logger: PinoLogger,
  ) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      ...(config.SMTP_USER
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD ?? '' } }
        : {}),
    });
  }

  /** Renders and sends one email. Throws if the mail server rejects it. */
  async send(message: EmailMessage): Promise<void> {
    const catalog = catalogs[message.locale].email;
    const template = catalog[message.template];
    const subject = format(template.subject, message.params);
    const text = `${format(template.body, message.params)}\n\n${catalog.ignoreNotice}\n\n— ${catalog.signature}`;
    const html = renderHtml(text, message.locale);

    await this.transport.sendMail({
      from: this.config.SMTP_FROM,
      to: message.to,
      subject,
      text,
      html,
    });
    // Recipient is personal data: log only the template, never the address or content.
    this.logger.info({ template: message.template, locale: message.locale }, 'Email sent');
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}

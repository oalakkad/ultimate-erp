import { Global, Module } from '@nestjs/common';
import { EmailDeliveryHandler, EmailOutbox } from './email-outbox.js';
import { Mailer } from './mailer.js';

/** Business code uses EmailOutbox only; Mailer (direct SMTP) is for the worker's handler. */
@Global()
@Module({
  providers: [Mailer, EmailOutbox, EmailDeliveryHandler],
  exports: [EmailOutbox, EmailDeliveryHandler],
})
export class MailModule {}

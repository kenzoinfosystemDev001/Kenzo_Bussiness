import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Category for delivery logs (never includes body content). */
  template: string;
}

/**
 * Mail delivery adapter. Phase 01 ships two transports:
 *  - `log`: development/production placeholder. In development it prints the
 *    message (so invitation/reset links are usable locally). In production it
 *    logs only recipient and template — never bodies that contain tokens.
 *  - `memory`: test transport; messages are captured for assertions.
 * An SMTP/SES transport plugs in behind the same interface (see roadmap).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  readonly sent: MailMessage[] = [];

  constructor(@Inject(ENV) private readonly env: Env) {}

  async send(message: MailMessage): Promise<void> {
    if (this.env.MAIL_TRANSPORT === 'memory') {
      this.sent.push(message);
      return;
    }
    if (this.env.NODE_ENV === 'production') {
      this.logger.warn(
        JSON.stringify({ msg: 'mail_not_delivered_no_transport', template: message.template, to: message.to.replace(/^(.{2}).*(@.*)$/, '$1***$2') }),
      );
      return;
    }
    this.logger.log(`\n──── email (${message.template}) ────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n────────────────────`);
    await Promise.resolve();
  }
}

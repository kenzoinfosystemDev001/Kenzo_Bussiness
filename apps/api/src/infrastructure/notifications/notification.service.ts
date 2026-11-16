import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { MailService } from '../mail/mail.service';
import { OutboxService } from '../outbox/outbox.service';
import type { Db } from '../prisma/prisma.service';

export interface NotifyInput {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  /** Relative app path, e.g. /approvals/123 */
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Also send an email via the outbox. */
  email?: { to: string; subject: string; text: string };
}

/**
 * In-app notifications are written in the caller's transaction; email copies
 * are queued through the outbox so provider failures never roll back business
 * changes and are retried independently.
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.outbox.on('notification.email', async (event) => {
      const p = event.payload as { to: string; subject: string; text: string; template: string };
      await this.mail.send({ to: p.to, subject: p.subject, text: p.text, template: p.template });
    });
  }

  async notify(db: Db, input: NotifyInput): Promise<void> {
    const notification = await db.notification.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 2000) ?? null,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
    });
    if (input.email) await this.queueEmail(db, { ...input.email, template: input.type, companyId: input.companyId, aggregateId: notification.id });
  }

  /** Email without an in-app notification (invitations, password resets). */
  async queueEmail(
    db: Db,
    input: { to: string; subject: string; text: string; template: string; companyId: string | null; aggregateId: string },
  ): Promise<void> {
    await this.outbox.enqueue(db, {
      companyId: input.companyId,
      eventType: 'notification.email',
      aggregateType: 'email',
      aggregateId: input.aggregateId,
      payload: { to: input.to, subject: input.subject, text: input.text, template: input.template },
    });
  }

  appUrl(path: string): string {
    return new URL(path, this.env.APP_ORIGIN).toString();
  }
}

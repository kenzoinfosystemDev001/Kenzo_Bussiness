import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ENV, type Env } from '../../config/env';
import { RequestContext } from '../../common/context/request-context';
import { PrismaService, type Db } from '../prisma/prisma.service';

export interface OutboxEventInput {
  companyId?: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface OutboxRecord {
  id: string;
  companyId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export type OutboxHandler = (event: OutboxRecord) => Promise<void>;

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Transactional outbox (PRD §7.5). `enqueue(tx, …)` writes the event in the
 * same DB transaction as the business change; the dispatcher publishes events
 * asynchronously with exponential backoff and dead-lettering. A failed email
 * therefore never rolls back a valid business transaction, and a committed
 * transaction can never lose its downstream event.
 *
 * Handlers must be idempotent: delivery is at-least-once.
 */
@Injectable()
export class OutboxService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Outbox');
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async enqueue(db: Db, input: OutboxEventInput): Promise<void> {
    await db.outboxEvent.create({
      data: {
        companyId: input.companyId ?? null,
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload as Prisma.InputJsonValue,
        correlationId: RequestContext.correlationId() ?? null,
      },
    });
  }

  on(eventType: string, handler: OutboxHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  onApplicationBootstrap(): void {
    if (this.env.OUTBOX_POLL_MS > 0) {
      this.timer = setInterval(() => void this.dispatchOnce().catch(() => undefined), this.env.OUTBOX_POLL_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Claims and processes one batch. Safe to run concurrently on several instances (SKIP LOCKED). */
  async dispatchOnce(): Promise<{ processed: number; failed: number }> {
    if (this.running) return { processed: 0, failed: 0 };
    this.running = true;
    let processed = 0;
    let failed = 0;
    try {
      await this.prisma.$executeRaw`
        UPDATE outbox_event SET status = 'FAILED', last_error = 'Recovered from stuck PROCESSING state'
        WHERE status = 'PROCESSING' AND available_at < now() - (${STUCK_AFTER_MS}::int * interval '1 millisecond')`;

      const claimed = await this.prisma.$queryRaw<
        Array<{
          id: string;
          company_id: string | null;
          event_type: string;
          aggregate_type: string;
          aggregate_id: string;
          payload: Record<string, unknown>;
          attempts: number;
        }>
      >`
        UPDATE outbox_event SET status = 'PROCESSING', available_at = now()
        WHERE id IN (
          SELECT id FROM outbox_event
          WHERE status IN ('PENDING', 'FAILED') AND available_at <= now()
          ORDER BY created_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, company_id, event_type, aggregate_type, aggregate_id, payload, attempts`;

      for (const row of claimed) {
        const event: OutboxRecord = {
          id: row.id,
          companyId: row.company_id,
          eventType: row.event_type,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
          attempts: row.attempts,
        };
        try {
          for (const handler of this.handlers.get(event.eventType) ?? []) await handler(event);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'PUBLISHED', publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
          });
          processed++;
        } catch (err) {
          failed++;
          const attempts = event.attempts + 1;
          const backoffMs = Math.min(2 ** attempts * 1000, 60 * 60 * 1000);
          await this.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: attempts >= MAX_ATTEMPTS ? 'DEAD' : 'FAILED',
              attempts,
              availableAt: new Date(Date.now() + backoffMs),
              lastError: (err as Error).message.slice(0, 2000),
            },
          });
          this.logger.warn(JSON.stringify({ msg: 'outbox_handler_failed', eventId: event.id, eventType: event.eventType, attempts }));
        }
      }
    } finally {
      this.running = false;
    }
    return { processed, failed };
  }
}

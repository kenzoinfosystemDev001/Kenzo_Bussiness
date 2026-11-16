import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;
/** Either the root client or an interactive transaction — services accept both. */
export type Db = PrismaClient | Tx;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a serializable-safe interactive transaction. Business writes and
   * their audit events / outbox rows commit atomically or not at all.
   */
  tx<T>(fn: (tx: Tx) => Promise<T>, options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeoutMs?: number } = {}): Promise<T> {
    return this.$transaction(fn, {
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 15_000,
      maxWait: 5_000,
    });
  }
}

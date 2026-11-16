import { Controller, Get, HttpCode } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/auth.decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. */
  @Get()
  @HttpCode(200)
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable and migrations applied. */
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const pending = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      if (Number(pending[0]?.count ?? 0) > 0) throw new Error('migrations in progress');
      return { status: 'ready', database: 'ok' };
    } catch {
      throw new AppError('INTERNAL_ERROR', 'Not ready');
    }
  }
}

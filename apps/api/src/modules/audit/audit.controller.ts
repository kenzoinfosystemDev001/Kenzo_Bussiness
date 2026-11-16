import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { auditQuerySchema } from '@kenzo/shared';
import type { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { cursorWhere, decodeCursor, encodeCursor } from '../../common/pagination';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Read-only access to the append-only audit trail, always scoped to the active company. */
@Controller('audit-events')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(@CurrentAuth() auth: AuthContext, @Query(zod(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>) {
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.AuditEventWhereInput = {
      companyId: auth.companyId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to ? { occurredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.q ? { OR: [{ action: { contains: q.q } }, { entityType: { contains: q.q } }, { reason: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(cursorWhere(cursor, 'occurredAt') as Prisma.AuditEventWhereInput),
    };
    const rows = await this.prisma.auditEvent.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        outcome: true,
        ipAddress: true,
        correlationId: true,
        occurredAt: true,
        actor: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? encodeCursor({ createdAt: last.occurredAt, id: last.id }) : null };
  }

  @Get(':id')
  @RequirePermissions('audit.read')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const event = await this.prisma.auditEvent.findFirst({
      where: { id, companyId: auth.companyId },
      include: { actor: { select: { id: true, fullName: true, email: true } } },
    });
    if (!event) throw AppError.notFound('Audit event');
    return event;
  }
}

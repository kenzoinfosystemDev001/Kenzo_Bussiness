import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginationQuery } from '@kenzo/shared';
import { z } from 'zod';
import { CurrentAuth } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { cursorWhere, decodeCursor, pageOf } from '../../common/pagination';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const listQuery = paginationQuery.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** A user's own in-app notifications. No permission needed beyond authentication — rows are owner-scoped. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query(zod(listQuery)) q: z.infer<typeof listQuery>) {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId: auth.userId,
        companyId: auth.companyId,
        ...(q.unread ? { readAt: null } : {}),
        ...(cursorWhere(decodeCursor(q.cursor)) as Prisma.NotificationWhereInput),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return pageOf(rows, q.limit);
  }

  @Get('unread-count')
  async unread(@CurrentAuth() auth: AuthContext) {
    return { count: await this.prisma.notification.count({ where: { userId: auth.userId, companyId: auth.companyId, readAt: null } }) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
    if (res.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, userId: auth.userId } });
      if (!exists) throw AppError.notFound('Notification');
    }
  }

  @Post('read-all')
  async markAll(@CurrentAuth() auth: AuthContext) {
    const res = await this.prisma.notification.updateMany({
      where: { userId: auth.userId, companyId: auth.companyId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  }
}

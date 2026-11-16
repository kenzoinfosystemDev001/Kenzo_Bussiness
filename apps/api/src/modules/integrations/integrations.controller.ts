import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { integrationConfigSchema, isSecretFieldName } from '@kenzo/shared';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const updateSchema = integrationConfigSchema.extend({ version: z.number().int().nonnegative() });

/**
 * Integration configuration (SSO, email, storage, OCR, ERP, HRMS …).
 * Only non-secret settings are stored. Any setting whose key looks like a
 * secret is rejected — secrets belong in the secret manager and are referenced
 * by name via `secretRef`.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private assertNoSecrets(settings: Record<string, unknown>) {
    const offending = Object.keys(settings).filter((k) => isSecretFieldName(k));
    if (offending.length) {
      throw AppError.validation(
        offending.map((k) => ({ path: `settings.${k}`, message: 'Secrets cannot be stored here. Put the value in the secret manager and set secretRef.' })),
      );
    }
  }

  @Get()
  @RequirePermissions('integration.read')
  async list(@CurrentAuth() auth: AuthContext) {
    return { items: await this.prisma.integrationConfig.findMany({ where: { companyId: auth.companyId }, orderBy: [{ kind: 'asc' }, { provider: 'asc' }] }) };
  }

  @Post()
  @RequirePermissions('integration.manage')
  async create(@CurrentAuth() auth: AuthContext, @Body(zod(integrationConfigSchema)) body: z.infer<typeof integrationConfigSchema>) {
    this.assertNoSecrets(body.settings);
    return this.prisma.tx(async (tx) => {
      const created = await tx.integrationConfig.create({
        data: {
          ...body,
          settings: body.settings as Prisma.InputJsonValue,
          secretRef: body.secretRef ?? null,
          companyId: auth.companyId,
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      await this.audit.record(tx, { action: 'integration.created', entityType: 'integration_config', entityId: created.id, after: body });
      return created;
    });
  }

  @Put(':id')
  @RequirePermissions('integration.manage')
  async update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateSchema)) body: z.infer<typeof updateSchema>) {
    this.assertNoSecrets(body.settings);
    const { version, ...data } = body;
    return this.prisma.tx(async (tx) => {
      const before = await tx.integrationConfig.findFirst({ where: { id, companyId: auth.companyId } });
      if (!before) throw AppError.notFound('Integration');
      const res = await tx.integrationConfig.updateMany({
        where: { id, version },
        data: {
          ...data,
          settings: data.settings as Prisma.InputJsonValue,
          secretRef: data.secretRef ?? null,
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, { action: 'integration.updated', entityType: 'integration_config', entityId: id, before, after: data });
      return tx.integrationConfig.findUniqueOrThrow({ where: { id } });
    });
  }
}

import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { NUMBERED_DOCUMENT_TYPES, numberingSeriesSchema, type NumberedDocumentType } from '@kenzo/shared';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NumberingService, TEMPLATE_PERIOD } from '../../infrastructure/numbering/numbering.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const docTypeParam = z.enum(NUMBERED_DOCUMENT_TYPES);
const updateSchema = numberingSeriesSchema.omit({ documentType: true }).extend({ version: z.number().int().nonnegative() });

@Controller('numbering-series')
export class NumberingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('numbering.read')
  async list(@CurrentAuth() auth: AuthContext) {
    const rows = await this.prisma.numberingSeries.findMany({ where: { companyId: auth.companyId }, orderBy: [{ documentType: 'asc' }, { periodKey: 'asc' }] });
    const templates = rows.filter((r) => r.isTemplate);
    const items = await Promise.all(
      templates.map(async (t) => ({
        id: t.id,
        documentType: t.documentType,
        prefix: t.prefix,
        pattern: t.pattern,
        padding: t.padding,
        resetPolicy: t.resetPolicy,
        version: t.version,
        periods: rows
          .filter((r) => !r.isTemplate && r.documentType === t.documentType)
          .map((r) => ({ periodKey: r.periodKey, nextValue: r.nextValue.toString() })),
        preview: await this.numbering.preview(this.prisma, auth.companyId, t.documentType as NumberedDocumentType),
      })),
    );
    return { items };
  }

  @Put(':documentType')
  @RequirePermissions('numbering.manage')
  async update(
    @CurrentAuth() auth: AuthContext,
    @Param('documentType', zod(docTypeParam)) documentType: NumberedDocumentType,
    @Body(zod(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    await this.prisma.tx(async (tx) => {
      const before = await tx.numberingSeries.findUnique({
        where: { companyId_documentType_periodKey: { companyId: auth.companyId, documentType, periodKey: TEMPLATE_PERIOD } },
      });
      if (!before) throw AppError.notFound('Numbering series');
      const res = await tx.numberingSeries.updateMany({
        where: { id: before.id, version: body.version },
        data: { prefix: body.prefix, pattern: body.pattern, padding: body.padding, resetPolicy: body.resetPolicy, version: { increment: 1 } },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      // Format changes apply to open periods; sequence counters are never reset by an edit.
      await tx.numberingSeries.updateMany({
        where: { companyId: auth.companyId, documentType, isTemplate: false },
        data: { prefix: body.prefix, pattern: body.pattern, padding: body.padding },
      });
      await this.audit.record(tx, {
        action: 'numbering.updated',
        entityType: 'numbering_series',
        entityId: before.id,
        before: { prefix: before.prefix, pattern: before.pattern, padding: before.padding, resetPolicy: before.resetPolicy },
        after: body,
      });
    });
    return this.list(auth);
  }

  @Post(':documentType/preview')
  @HttpCode(200)
  @RequirePermissions('numbering.read')
  preview(
    @CurrentAuth() auth: AuthContext,
    @Param('documentType', zod(docTypeParam)) documentType: NumberedDocumentType,
    @Body(zod(numberingSeriesSchema.omit({ documentType: true }))) body: z.infer<typeof updateSchema>,
  ) {
    return this.numbering.preview(this.prisma, auth.companyId, documentType, body);
  }
}

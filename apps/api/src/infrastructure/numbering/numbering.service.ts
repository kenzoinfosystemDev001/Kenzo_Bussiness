import { Injectable } from '@nestjs/common';
import { DEFAULT_NUMBER_PREFIXES, NUMBERED_DOCUMENT_TYPES, fiscalYearOf, renderNumberPattern, type NumberedDocumentType } from '@kenzo/shared';
import { AppError } from '../../common/errors/app-error';
import type { Db, Tx } from '../prisma/prisma.service';

export const TEMPLATE_PERIOD = 'TEMPLATE';
export const DEFAULT_PATTERN = '{PREFIX}-{FY}-{SEQ}';

/**
 * Gap-minimised, collision-free document numbering (PRD §8.4).
 *
 * Configuration lives in a per-document-type TEMPLATE row. Allocation lazily
 * creates the period row (per fiscal year, or ALL when the series never resets)
 * and increments it with a single atomic `UPDATE … RETURNING` — the row lock
 * serialises concurrent allocators, and because allocation runs inside the
 * caller's transaction a rolled-back transaction also rolls back its number.
 * Every issued number is registered in `generated_number` (unique per company
 * and document type) as a second line of defence.
 */
@Injectable()
export class NumberingService {
  async ensureTemplates(db: Db, companyId: string): Promise<void> {
    for (const documentType of NUMBERED_DOCUMENT_TYPES) {
      await db.numberingSeries.upsert({
        where: { companyId_documentType_periodKey: { companyId, documentType, periodKey: TEMPLATE_PERIOD } },
        create: {
          companyId,
          documentType,
          periodKey: TEMPLATE_PERIOD,
          prefix: DEFAULT_NUMBER_PREFIXES[documentType],
          pattern: DEFAULT_PATTERN,
          padding: 6,
          resetPolicy: 'FISCAL_YEAR',
          isTemplate: true,
        },
        update: {},
      });
    }
  }

  async next(
    tx: Tx,
    input: { companyId: string; documentType: NumberedDocumentType; date?: Date; entityId?: string | null; issuedById?: string | null },
  ): Promise<string> {
    const date = input.date ?? new Date();
    const [company, template] = await Promise.all([
      tx.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { timezone: true, fiscalYearStartMonth: true } }),
      tx.numberingSeries.findUnique({
        where: { companyId_documentType_periodKey: { companyId: input.companyId, documentType: input.documentType, periodKey: TEMPLATE_PERIOD } },
      }),
    ]);
    if (!template) throw AppError.invalidState(`Numbering series for ${input.documentType} is not configured`);
    const fy = fiscalYearOf(date, company.fiscalYearStartMonth, company.timezone);
    const periodKey = template.resetPolicy === 'FISCAL_YEAR' ? fy.label : 'ALL';

    await tx.$executeRaw`
      INSERT INTO numbering_series (id, company_id, document_type, period_key, prefix, pattern, padding, reset_policy, next_value, is_template, updated_at)
      VALUES (gen_random_uuid(), ${input.companyId}::uuid, ${input.documentType}, ${periodKey}, ${template.prefix}, ${template.pattern},
              ${template.padding}, ${template.resetPolicy}::"NumberResetPolicy", 1, false, now())
      ON CONFLICT (company_id, document_type, period_key) DO NOTHING`;

    const rows = await tx.$queryRaw<Array<{ seq: bigint; prefix: string; pattern: string; padding: number }>>`
      UPDATE numbering_series SET next_value = next_value + 1, updated_at = now()
      WHERE company_id = ${input.companyId}::uuid AND document_type = ${input.documentType} AND period_key = ${periodKey}
      RETURNING next_value - 1 AS seq, prefix, pattern, padding`;
    const row = rows[0];
    if (!row) throw new Error('Numbering allocation failed');

    const number = renderNumberPattern(row.pattern, {
      prefix: row.prefix,
      fiscalYear: fy,
      date,
      timeZone: company.timezone,
      sequence: Number(row.seq),
      padding: row.padding,
    });
    await tx.generatedNumber.create({
      data: { companyId: input.companyId, documentType: input.documentType, number, entityId: input.entityId ?? null, issuedById: input.issuedById ?? null },
    });
    return number;
  }

  async preview(
    db: Db,
    companyId: string,
    documentType: NumberedDocumentType,
    override?: { prefix: string; pattern: string; padding: number; resetPolicy: 'NEVER' | 'FISCAL_YEAR' },
  ) {
    const [company, template] = await Promise.all([
      db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true, fiscalYearStartMonth: true } }),
      db.numberingSeries.findUnique({ where: { companyId_documentType_periodKey: { companyId, documentType, periodKey: TEMPLATE_PERIOD } } }),
    ]);
    const cfg = override ?? template;
    if (!cfg) throw AppError.notFound('Numbering series');
    const date = new Date();
    const fy = fiscalYearOf(date, company.fiscalYearStartMonth, company.timezone);
    const periodKey = cfg.resetPolicy === 'FISCAL_YEAR' ? fy.label : 'ALL';
    const current = await db.numberingSeries.findUnique({ where: { companyId_documentType_periodKey: { companyId, documentType, periodKey } } });
    const sequence = Number(current?.nextValue ?? 1n);
    return {
      periodKey,
      nextSequence: sequence,
      example: renderNumberPattern(cfg.pattern, { prefix: cfg.prefix, fiscalYear: fy, date, timeZone: company.timezone, sequence, padding: cfg.padding }),
    };
  }
}

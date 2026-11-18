import { Injectable } from '@nestjs/common';
import { AWARD_STATUS_LABELS, COMPARABILITY_BLOCKER_LABELS, type ComparabilityBlocker } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { renderPdf, type PdfBlock } from '../../infrastructure/pdf/simple-pdf';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AwardService } from './award.service';
import { EvaluationService } from './evaluation.service';

export interface RenderedReport {
  filename: string;
  mimeType: string;
  body: Buffer;
}

/**
 * Sends a generated report as a download. Reports carry commercial detail, so
 * they are never cached and never rendered in the browser's own context.
 */
export function sendReport(res: { setHeader(name: string, value: string): void; end(body: Buffer): void }, report: RenderedReport): void {
  res.setHeader('Content-Type', report.mimeType);
  res.setHeader('Content-Length', String(report.body.length));
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"; filename*=UTF-8''${encodeURIComponent(report.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(report.body);
}

/**
 * Procurement reports. Every figure is read from the stored records — nothing
 * is recomputed with different rules at print time, so a report and the screen
 * it came from can never disagree.
 *
 * Spreadsheet exports are CSV (UTF-8 with a BOM, which Excel opens directly).
 * The repository has no spreadsheet dependency and writing one is not worth a
 * binary format here: the data is flat and every consumer reads CSV.
 */
@Injectable()
export class SourcingReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluation: EvaluationService,
    private readonly awards: AwardService,
  ) {}

  // ── CSV ──────────────────────────────────────────────────────────────────

  private csv(rows: Array<Array<string | number | null | undefined>>): Buffer {
    const cell = (v: string | number | null | undefined) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // The BOM makes Excel read it as UTF-8 rather than the local code page.
    return Buffer.from('﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8');
  }

  // ── Comparison ───────────────────────────────────────────────────────────

  /** Side-by-side comparison: one column per vendor, one block per item. */
  async comparison(auth: AuthContext, rfqId: string, format: 'pdf' | 'csv'): Promise<RenderedReport> {
    const c = await this.evaluation.comparison(auth, rfqId);
    const name = `comparison-${c.rfq.rfqNo}`;

    if (format === 'csv') {
      const header = [
        'Item',
        'Description',
        'Qty',
        'UoM',
        ...c.columns.flatMap((col) => [`${col.vendor.legalName} unit price`, `${col.vendor.legalName} line total`]),
      ];
      const rows: Array<Array<string | number | null>> = [[`RFQ ${c.rfq.rfqNo}`, c.rfq.title], [`Basis currency`, c.basisCurrency], [], header];
      for (const line of c.lines) {
        const cells: Array<string | number | null> = [line.lineNo, line.description, line.quantity, line.uom];
        for (const col of c.columns) {
          const ql = col.lines.find((l) => l.rfqLineId === line.id);
          cells.push(ql?.quoted ? (ql.unitPrice ?? null) : 'not quoted', ql?.quoted ? (ql.total ?? null) : '');
        }
        rows.push(cells);
      }
      rows.push([]);
      for (const [label, key] of [
        ['Subtotal', 'subtotal'],
        ['Discount', 'discountTotal'],
        ['Taxable', 'taxableTotal'],
        ['Tax', 'taxTotal'],
        ['Freight', 'freight'],
        ['Other charges', 'otherCharges'],
        ['Grand total (quoted currency)', 'grandTotal'],
      ] as const) {
        rows.push([
          label,
          '',
          '',
          '',
          ...c.columns.flatMap((col) => ['', col.landedCost ? ((col.landedCost as Record<string, string | null>)[key] ?? '') : '']),
        ]);
      }
      rows.push([`Comparable total (${c.basisCurrency})`, '', '', '', ...c.columns.flatMap((col) => ['', col.comparableTotal ?? 'not comparable'])]);
      rows.push(['Currency', '', '', '', ...c.columns.flatMap((col) => ['', col.currency ?? ''])]);
      rows.push(['Tax treatment', '', '', '', ...c.columns.flatMap((col) => ['', col.taxTreatment ?? ''])]);
      rows.push(['Delivery lead days', '', '', '', ...c.columns.flatMap((col) => ['', col.deliveryLeadDays ?? ''])]);
      rows.push(['Warranty', '', '', '', ...c.columns.flatMap((col) => ['', col.warranty ?? ''])]);
      rows.push(['Payment terms', '', '', '', ...c.columns.flatMap((col) => ['', col.paymentTerms ?? ''])]);
      rows.push(['Valid until', '', '', '', ...c.columns.flatMap((col) => ['', col.validUntil ? String(col.validUntil).slice(0, 10) : ''])]);
      rows.push(['Weighted score', '', '', '', ...c.columns.flatMap((col) => ['', col.score ?? ''])]);
      rows.push(['Caveats', '', '', '', ...c.columns.flatMap((col) => ['', col.blockerLabels.join('; ')])]);
      return { filename: `${name}.csv`, mimeType: 'text/csv; charset=utf-8', body: this.csv(rows) };
    }

    const blocks: PdfBlock[] = [
      { text: `Quotation comparison — RFQ ${c.rfq.rfqNo}`, style: 'title' },
      { text: c.rfq.title, style: 'body' },
      { text: `Basis currency: ${c.basisCurrency}    Generated: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, style: 'small' },
    ];

    blocks.push({ text: 'Vendors', style: 'heading', spaceBefore: 12 });
    for (const col of c.columns) {
      const lc = col.landedCost;
      blocks.push({ text: `${col.vendor.legalName} (${col.vendor.vendorCode}) — ${col.quotationNo} v${col.versionNo}`, style: 'heading', spaceBefore: 8 });
      blocks.push({
        text: [
          `Currency: ${col.currency ?? '—'}   Tax: ${col.taxTreatment ?? '—'}   Valid until: ${col.validUntil ? String(col.validUntil).slice(0, 10) : '—'}`,
          `Delivery: ${col.deliveryLeadDays ?? '—'} days   Warranty: ${col.warranty ?? '—'}   Payment: ${col.paymentTerms ?? '—'}`,
          lc
            ? [
                `Subtotal ${lc.subtotal}  - Discount ${lc.discountTotal}  = Taxable ${lc.taxableTotal}`,
                `+ Tax ${lc.taxTotal}  + Freight ${lc.freight}  + Other ${lc.otherCharges}  = Grand total ${lc.grandTotal} ${col.currency}`,
                `Comparable total: ${col.comparableTotal ?? 'not comparable'} ${c.basisCurrency}`,
              ].join('\n')
            : 'No submitted version.',
          col.blockerLabels.length ? `Caveats: ${col.blockerLabels.join('; ')}` : '',
          col.score ? `Weighted score: ${col.score} / 100` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        style: 'mono',
      });
    }

    blocks.push({ text: 'Item-wise comparison', style: 'heading', spaceBefore: 14 });
    for (const line of c.lines) {
      const quotes = c.columns.map((col) => {
        const ql = col.lines.find((l) => l.rfqLineId === line.id);
        const lowest = c.indicators.lowestByLine[line.id] === col.quotationId ? '  <= lowest' : '';
        return ql?.quoted ? `  ${col.vendor.legalName}: ${ql.unitPrice} x ${ql.quantity} = ${ql.total}${lowest}` : `  ${col.vendor.legalName}: not quoted`;
      });
      blocks.push({ text: [`${line.lineNo}. ${line.description} (${line.quantity} ${line.uom})`, ...quotes].join('\n'), style: 'mono', spaceBefore: 6 });
    }

    if (c.insights.length) {
      blocks.push({ text: 'Observations', style: 'heading', spaceBefore: 14 });
      for (const i of c.insights) blocks.push({ text: `- ${i.text}`, style: 'body' });
    }
    blocks.push({
      text: 'Figures are taken from the stored quotations. Totals marked "not comparable" are quoted in a currency with no approved exchange rate, or on a different tax basis, and are deliberately not converted.',
      style: 'small',
      spaceBefore: 12,
    });
    return {
      filename: `${name}.pdf`,
      mimeType: 'application/pdf',
      body: renderPdf(blocks, { title: `Comparison ${c.rfq.rfqNo}`, footer: `Quotation comparison - RFQ ${c.rfq.rfqNo}` }),
    };
  }

  // ── Evaluation ───────────────────────────────────────────────────────────

  /** Evaluation report: criteria, weights, every score and the working behind it. */
  async evaluationReport(auth: AuthContext, rfqId: string, format: 'pdf' | 'csv'): Promise<RenderedReport> {
    const e = await this.evaluation.detail(auth, rfqId);
    const rfq = await this.prisma.rfq.findFirstOrThrow({ where: { id: rfqId, companyId: auth.companyId }, select: { rfqNo: true, title: true } });
    const name = `evaluation-${rfq.rfqNo}`;

    if (format === 'csv') {
      const rows: Array<Array<string | number | null>> = [
        [`RFQ ${rfq.rfqNo}`, rfq.title],
        ['Criteria set', `${e.criteriaSet.name} v${e.criteriaSet.setVersion}`],
        ['Formula', e.formulaVersion],
        ['Basis currency', e.basisCurrency],
        [],
        ['Vendor', 'Quotation', 'Version', 'Criterion', 'Source', 'Weight %', 'Raw value', 'Normalised', 'Weighted', 'Missing', 'Scored by', 'Note'],
      ];
      for (const q of e.quotations) {
        for (const s of q.scores) {
          rows.push([
            q.vendor.legalName,
            q.quotationNo,
            q.versionNo,
            s.criterionKey,
            s.source,
            s.weightPercent,
            s.rawValue,
            s.normalizedScore,
            s.weightedScore,
            s.missing ? 'yes' : 'no',
            s.scoredBy?.fullName ?? '',
            s.note ?? '',
          ]);
        }
        rows.push([
          q.vendor.legalName,
          q.quotationNo,
          q.versionNo,
          'TOTAL',
          '',
          '100.00',
          q.comparableTotal,
          '',
          q.totalScore,
          '',
          '',
          q.excluded ? `excluded: ${q.exclusionReason}` : '',
        ]);
      }
      return { filename: `${name}.csv`, mimeType: 'text/csv; charset=utf-8', body: this.csv(rows) };
    }

    const blocks: PdfBlock[] = [
      { text: `Evaluation report — RFQ ${rfq.rfqNo}`, style: 'title' },
      { text: rfq.title, style: 'body' },
      {
        text: `Criteria set: ${e.criteriaSet.name} v${e.criteriaSet.setVersion}    Formula: ${e.formulaVersion}    Basis: ${e.basisCurrency}\nStarted by ${e.startedBy.fullName} on ${String(e.startedAt).slice(0, 10)}${e.completedAt ? `, completed ${String(e.completedAt).slice(0, 10)}` : ''}`,
        style: 'small',
      },
      { text: 'Criteria and weights', style: 'heading', spaceBefore: 12 },
      {
        text: e.criteriaSet.criteria
          .map((c) => `  ${(c.weightPercent ?? '0.00').padStart(6)} %  ${c.key} — ${c.label} (${c.source}, ${c.direction})`)
          .join('\n'),
        style: 'mono',
      },
    ];

    blocks.push({ text: 'Scores', style: 'heading', spaceBefore: 14 });
    const ranked = [...e.quotations].sort((a, b) => (a.totalScore && b.totalScore ? Number(b.totalScore) - Number(a.totalScore) : 0));
    for (const q of ranked) {
      blocks.push({
        text: `${q.vendor.legalName} — ${q.quotationNo} v${q.versionNo}${q.excluded ? '  [EXCLUDED]' : ''}`,
        style: 'heading',
        spaceBefore: 8,
      });
      const lines = q.scores.map(
        (s) =>
          `  ${s.criterionKey.padEnd(20)} ${String(s.rawValue ?? 'missing').padStart(14)}  x ${String(s.weightPercent).padStart(6)} %  ->  ${String(s.normalizedScore ?? '0').padStart(9)}  =  ${String(s.weightedScore ?? '0').padStart(9)}`,
      );
      blocks.push({
        text: [
          ...lines,
          `  ${'TOTAL'.padEnd(20)} ${String(q.comparableTotal ?? '').padStart(14)}                            =  ${String(q.totalScore ?? '—').padStart(9)}`,
          q.blockerLabels.length ? `  Caveats: ${q.blockerLabels.join('; ')}` : '',
          q.excluded ? `  Exclusion: ${q.exclusionReason}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        style: 'mono',
      });
    }

    if (e.declarations.length) {
      blocks.push({ text: 'Conflict-of-interest declarations', style: 'heading', spaceBefore: 14 });
      blocks.push({
        text: e.declarations
          .map((d) => `  ${String(d.declaredAt).slice(0, 10)}  ${d.user.fullName}: ${d.hasConflict ? `conflict declared — ${d.details}` : 'no conflict'}`)
          .join('\n'),
        style: 'mono',
      });
    }
    if (e.notes.length) {
      blocks.push({ text: 'Reviewer notes', style: 'heading', spaceBefore: 14 });
      for (const n of e.notes)
        blocks.push({ text: `${String(n.occurredAt).slice(0, 16).replace('T', ' ')} — ${n.author.fullName}: ${n.note}`, style: 'small' });
    }
    if (e.summaryNote) {
      blocks.push({ text: 'Evaluation summary', style: 'heading', spaceBefore: 14 }, { text: e.summaryNote, style: 'body' });
    }
    return {
      filename: `${name}.pdf`,
      mimeType: 'application/pdf',
      body: renderPdf(blocks, { title: `Evaluation ${rfq.rfqNo}`, footer: `Evaluation report - RFQ ${rfq.rfqNo}` }),
    };
  }

  // ── Award ────────────────────────────────────────────────────────────────

  /**
   * One document in three shapes:
   *  recommendation — what is proposed and why, before approval;
   *  approval       — who decided what, and when;
   *  award          — the issued award with its frozen commercial snapshot.
   */
  async awardReport(auth: AuthContext, awardId: string, kind: 'recommendation' | 'approval' | 'award'): Promise<RenderedReport> {
    const a = await this.awards.detail(auth, awardId);
    if (kind === 'award' && a.status !== 'AWARDED') throw AppError.invalidState('The final award document exists only once the award is issued');

    const titles = {
      recommendation: 'Award recommendation',
      approval: 'Award approval report',
      award: 'Award',
    } as const;

    const blocks: PdfBlock[] = [
      { text: `${titles[kind]} — ${a.awardNo}`, style: 'title' },
      { text: `RFQ ${a.rfq.rfqNo}: ${a.rfq.title}`, style: 'body' },
      {
        text: [
          `Status: ${AWARD_STATUS_LABELS[a.status]}    Type: ${a.awardType === 'PARTIAL' ? 'Partial award' : 'Full award'}`,
          `Recommended by ${a.recommendedBy.fullName} on ${String(a.recommendedAt).slice(0, 10)}`,
          a.approvedAt ? `Approved ${String(a.approvedAt).slice(0, 10)}` : '',
          a.awardedAt ? `Issued ${String(a.awardedAt).slice(0, 10)}` : '',
          `Total awarded value: ${a.totalAwardedValue} ${a.currency}`,
        ]
          .filter(Boolean)
          .join('\n'),
        style: 'small',
      },
    ];

    blocks.push({ text: 'Awarded items', style: 'heading', spaceBefore: 12 });
    for (const l of a.lines) {
      blocks.push({
        text: [
          `${l.rfqLine.lineNo}. ${l.rfqLine.description}`,
          `   Vendor:   ${l.vendor.legalName} (${l.vendor.vendorCode})`,
          `   Quote:    ${l.quotation.quotationNo} v${l.quotationVersion.versionNo}, valid to ${String(l.quotationVersion.validUntil).slice(0, 10)}`,
          `   Terms:    ${l.quotationVersion.deliveryLeadDays ?? '—'} days lead, warranty ${l.quotationVersion.warranty ?? '—'}, payment ${l.quotationVersion.paymentTerms ?? '—'}`,
          `   Price:    ${l.quantity} ${l.rfqLine.uom} x ${l.unitPrice} ${l.currency} (${l.taxTreatment.toLowerCase()} of tax), discount ${l.discountPercent} %, tax ${l.taxRate} %`,
          `   Total:    ${l.lineTotal} ${l.currency}${l.currency === a.currency ? '' : `  =  ${l.comparableTotal} ${a.currency}`}`,
        ].join('\n'),
        style: 'mono',
        spaceBefore: 6,
      });
    }

    blocks.push({ text: 'Rationale', style: 'heading', spaceBefore: 14 }, { text: a.rationale, style: 'body' });
    if (a.expiredException) {
      blocks.push(
        { text: 'Recorded exception', style: 'heading', spaceBefore: 10 },
        { text: `A quotation past its validity was awarded. Reason: ${a.expiredException}`, style: 'body' },
      );
    }

    if (kind !== 'recommendation') {
      blocks.push({ text: 'Approval evidence', style: 'heading', spaceBefore: 14 });
      blocks.push({
        text: a.events
          .map(
            (e) =>
              `  ${String(e.occurredAt).slice(0, 16).replace('T', ' ')}  ${e.fromStatus ?? '(new)'} -> ${e.toStatus}  ${e.actor?.fullName ?? 'system'}${e.reason ? ` — ${e.reason}` : ''}`,
          )
          .join('\n'),
        style: 'mono',
      });
      if (a.approval) {
        blocks.push({
          text: `Approval instance ${a.approval.id}: ${a.approval.status}, submitted ${String(a.approval.submittedAt).slice(0, 16).replace('T', ' ')}${a.approval.completedAt ? `, completed ${String(a.approval.completedAt).slice(0, 16).replace('T', ' ')}` : ''}.`,
          style: 'small',
        });
      }
    }

    if (kind === 'award') {
      blocks.push({
        text: 'This document records the commercial terms as they stood when the award was issued. They are frozen: a later revision of any quotation does not change them.',
        style: 'small',
        spaceBefore: 12,
      });
    } else {
      blocks.push({
        text: 'This document is a recommendation and creates no commitment to purchase until the award is approved and issued.',
        style: 'small',
        spaceBefore: 12,
      });
    }

    return {
      filename: `${kind}-${a.awardNo}.pdf`,
      mimeType: 'application/pdf',
      body: renderPdf(blocks, { title: `${titles[kind]} ${a.awardNo}`, footer: `${titles[kind]} - ${a.awardNo}` }),
    };
  }

  /** Award lines as a spreadsheet, for purchase-order preparation. */
  async awardCsv(auth: AuthContext, awardId: string): Promise<RenderedReport> {
    const a = await this.awards.detail(auth, awardId);
    const rows: Array<Array<string | number | null>> = [
      [`Award ${a.awardNo}`, `RFQ ${a.rfq.rfqNo}`, a.rfq.title],
      ['Status', AWARD_STATUS_LABELS[a.status], 'Type', a.awardType, 'Total', a.totalAwardedValue, a.currency],
      [],
      [
        'Item',
        'Description',
        'UoM',
        'Vendor code',
        'Vendor',
        'Quotation',
        'Version',
        'Qty',
        'Unit price',
        'Currency',
        'Tax basis',
        'Discount %',
        'Tax %',
        'Line total',
        `Total (${a.currency})`,
      ],
    ];
    for (const l of a.lines) {
      rows.push([
        l.rfqLine.lineNo,
        l.rfqLine.description,
        l.rfqLine.uom,
        l.vendor.vendorCode,
        l.vendor.legalName,
        l.quotation.quotationNo,
        l.quotationVersion.versionNo,
        l.quantity,
        l.unitPrice,
        l.currency,
        l.taxTreatment,
        l.discountPercent,
        l.taxRate,
        l.lineTotal,
        l.comparableTotal,
      ]);
    }
    return { filename: `award-${a.awardNo}.csv`, mimeType: 'text/csv; charset=utf-8', body: this.csv(rows) };
  }

  /** Blocker labels for a quotation, used by the workspace header. */
  labelBlockers(blockers: ComparabilityBlocker[]): string[] {
    return blockers.map((b) => COMPARABILITY_BLOCKER_LABELS[b] ?? b);
  }
}

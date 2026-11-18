import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  awardDecisionSchema,
  conflictDeclarationSchema,
  criteriaSetSchema,
  evaluationNoteSchema,
  exchangeRateSchema,
  manualScoreSchema,
  recommendAwardSchema,
  startEvaluationSchema,
  AWARD_STATUSES,
} from '@kenzo/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { AwardService } from './award.service';
import { EvaluationService } from './evaluation.service';
import { SourcingReportsService, sendReport } from './sourcing-reports.service';

const formatQuery = z.object({ format: z.enum(['pdf', 'csv']).default('pdf') });
const awardListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.enum(AWARD_STATUSES))),
});

/** Company-wide evaluation configuration: criteria sets and approved rates. */
@Controller('evaluation')
export class EvaluationConfigController {
  constructor(private readonly evaluation: EvaluationService) {}

  @Get('criteria-sets')
  @RequirePermissions('quotation.read')
  listSets(@CurrentAuth() auth: AuthContext) {
    return this.evaluation.listCriteriaSets(auth);
  }

  @Post('criteria-sets')
  @RequirePermissions('evaluation.configure')
  createSet(@CurrentAuth() auth: AuthContext, @Body(zod(criteriaSetSchema)) body: z.infer<typeof criteriaSetSchema>) {
    return this.evaluation.createCriteriaSet(auth, body);
  }

  @Get('criteria-sets/:id')
  @RequirePermissions('quotation.read')
  set(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.criteriaSet(auth, id);
  }

  @Post('criteria-sets/:id/publish')
  @HttpCode(200)
  @RequirePermissions('evaluation.configure')
  publishSet(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.publishCriteriaSet(auth, id);
  }

  @Get('exchange-rates')
  @RequirePermissions('quotation.read')
  rates(@CurrentAuth() auth: AuthContext) {
    return this.evaluation.listRates(auth);
  }

  @Post('exchange-rates')
  @RequirePermissions('exchange_rate.manage')
  recordRate(@CurrentAuth() auth: AuthContext, @Body(zod(exchangeRateSchema)) body: z.infer<typeof exchangeRateSchema>) {
    return this.evaluation.recordRate(auth, body);
  }
}

/** The evaluation round for one RFQ, and the award raised from it. */
@Controller('rfqs/:rfqId/evaluation')
export class RfqEvaluationController {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly awards: AwardService,
    private readonly reports: SourcingReportsService,
  ) {}

  @Get()
  @RequirePermissions('quotation.read')
  detail(@CurrentAuth() auth: AuthContext, @Param('rfqId', ParseUUIDPipe) rfqId: string) {
    return this.evaluation.detail(auth, rfqId);
  }

  @Post()
  @RequirePermissions('quotation.manage')
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body(zod(startEvaluationSchema)) body: z.infer<typeof startEvaluationSchema>,
  ) {
    return this.evaluation.start(auth, rfqId, body);
  }

  @Post('declarations')
  @RequirePermissions('quotation.read')
  declare(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body(zod(conflictDeclarationSchema)) body: z.infer<typeof conflictDeclarationSchema>,
  ) {
    return this.evaluation.declareConflict(auth, rfqId, body);
  }

  @Post('notes')
  @RequirePermissions('quotation.manage')
  note(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body(zod(evaluationNoteSchema)) body: z.infer<typeof evaluationNoteSchema>,
  ) {
    return this.evaluation.addNote(auth, rfqId, body.note);
  }

  @Post('quotations/:quotationId/scores')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  score(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body(zod(manualScoreSchema)) body: z.infer<typeof manualScoreSchema>,
  ) {
    return this.evaluation.score(auth, rfqId, quotationId, body);
  }

  @Post('quotations/:quotationId/exclude')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  exclude(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body(zod(awardDecisionSchema)) body: z.infer<typeof awardDecisionSchema>,
  ) {
    return this.evaluation.exclude(auth, rfqId, quotationId, body.reason);
  }

  @Post('recompute')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  recompute(@CurrentAuth() auth: AuthContext, @Param('rfqId', ParseUUIDPipe) rfqId: string) {
    return this.evaluation.recompute(auth, rfqId);
  }

  @Post('complete')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body(zod(evaluationNoteSchema)) body: z.infer<typeof evaluationNoteSchema>,
  ) {
    return this.evaluation.complete(auth, rfqId, body.note);
  }

  @Post('award')
  @RequirePermissions('quotation.award')
  recommend(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Body(zod(recommendAwardSchema)) body: z.infer<typeof recommendAwardSchema>,
  ) {
    return this.awards.recommend(auth, rfqId, body);
  }

  @Get('award')
  @RequirePermissions('quotation.read')
  awardsForRfq(@CurrentAuth() auth: AuthContext, @Param('rfqId', ParseUUIDPipe) rfqId: string) {
    return this.awards.forRfq(auth, rfqId);
  }

  @Get('report')
  @RequirePermissions('quotation.read')
  async report(
    @CurrentAuth() auth: AuthContext,
    @Param('rfqId', ParseUUIDPipe) rfqId: string,
    @Query(zod(formatQuery)) q: z.infer<typeof formatQuery>,
    @Res() res: Response,
  ) {
    sendReport(res, await this.reports.evaluationReport(auth, rfqId, q.format));
  }
}

@Controller('awards')
export class AwardsController {
  constructor(
    private readonly awards: AwardService,
    private readonly reports: SourcingReportsService,
  ) {}

  @Get()
  @RequirePermissions('quotation.read')
  list(@CurrentAuth() auth: AuthContext, @Query(zod(awardListQuery)) q: z.infer<typeof awardListQuery>) {
    return this.awards.list(auth, q);
  }

  @Get(':id')
  @RequirePermissions('quotation.read')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.awards.detail(auth, id);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermissions('quotation.award')
  issue(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.awards.issue(auth, id);
  }

  @Post(':id/resubmit')
  @HttpCode(200)
  @RequirePermissions('quotation.award')
  resubmit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.awards.resubmit(auth, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('quotation.award')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(awardDecisionSchema)) body: z.infer<typeof awardDecisionSchema>) {
    return this.awards.cancel(auth, id, body.reason);
  }

  @Get(':id/recommendation')
  @RequirePermissions('quotation.read')
  async recommendation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendReport(res, await this.reports.awardReport(auth, id, 'recommendation'));
  }

  @Get(':id/approval-report')
  @RequirePermissions('quotation.read')
  async approvalReport(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendReport(res, await this.reports.awardReport(auth, id, 'approval'));
  }

  @Get(':id/document')
  @RequirePermissions('quotation.read')
  async document(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendReport(res, await this.reports.awardReport(auth, id, 'award'));
  }

  @Get(':id/export')
  @RequirePermissions('quotation.read')
  async exportCsv(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    sendReport(res, await this.reports.awardCsv(auth, id));
  }
}

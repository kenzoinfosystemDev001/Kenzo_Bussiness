import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  createQuotationSchema,
  declineInvitationSchema,
  directPurchaseSchema,
  extendDeadlineSchema,
  inviteVendorsSchema,
  quotationActionSchema,
  quotationVersionSchema,
  reminderSchema,
  requisitionListQuery,
  requisitionSchema,
  rfqListQuery,
  rfqSchema,
  submitQuotationVersionSchema,
  updateRequisitionSchema,
  updateRfqSchema,
} from '@kenzo/shared';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { EvaluationService } from './evaluation.service';
import { QuotationsService } from './quotations.service';
import { RequisitionsService } from './requisitions.service';
import { RfqService } from './rfq.service';
import { SourcingReportsService, sendReport } from './sourcing-reports.service';

const reason = z.object({ reason: z.string().trim().min(5, 'Give a reason').max(2000) });
const optionalReason = z.object({ reason: z.string().trim().max(2000).optional() });
const note = z.object({ note: z.string().trim().max(1000).nullish() });
const reportFormat = z.object({ format: z.enum(['pdf', 'csv']).default('pdf') });
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().DOCUMENT_MAX_BYTES, files: 1, fields: 5 } });

@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly requisitions: RequisitionsService) {}

  @Get()
  @RequirePermissions('requisition.read')
  list(@CurrentAuth() auth: AuthContext, @Query(zod(requisitionListQuery)) q: z.infer<typeof requisitionListQuery>) {
    return this.requisitions.list(auth, q);
  }

  @Get('stats')
  @RequirePermissions('requisition.read')
  stats(@CurrentAuth() auth: AuthContext) {
    return this.requisitions.stats(auth);
  }

  @Post()
  @RequirePermissions('requisition.create')
  create(@CurrentAuth() auth: AuthContext, @Body(zod(requisitionSchema)) body: z.infer<typeof requisitionSchema>) {
    return this.requisitions.create(auth, body);
  }

  @Get(':id')
  @RequirePermissions('requisition.read')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.requisitions.detail(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('requisition.create')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateRequisitionSchema)) body: z.infer<typeof updateRequisitionSchema>,
  ) {
    return this.requisitions.update(auth, id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('requisition.create')
  submit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(note)) body: z.infer<typeof note>) {
    return this.requisitions.submit(auth, id, body.note);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermissions('requisition.create')
  withdraw(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(reason)) body: z.infer<typeof reason>) {
    return this.requisitions.withdraw(auth, id, body.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('requisition.read')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(reason)) body: z.infer<typeof reason>) {
    return this.requisitions.cancel(auth, id, body.reason);
  }

  @Post(':id/direct-purchase')
  @HttpCode(200)
  @RequirePermissions('po.create')
  direct(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(directPurchaseSchema)) body: z.infer<typeof directPurchaseSchema>,
  ) {
    return this.requisitions.chooseDirectPurchase(auth, id, body.vendorId, body.reason);
  }

  @Post(':id/attachments')
  @RequirePermissions('requisition.create', 'document.upload')
  @UseInterceptors(upload)
  attach(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'Attach a file' }]);
    return this.requisitions.addAttachment(auth, id, file);
  }
}

@Controller('rfqs')
export class RfqController {
  constructor(
    private readonly rfqs: RfqService,
    private readonly quotations: QuotationsService,
    private readonly evaluation: EvaluationService,
    private readonly reports: SourcingReportsService,
  ) {}

  @Get()
  @RequirePermissions('rfq.read')
  list(@CurrentAuth() auth: AuthContext, @Query(zod(rfqListQuery)) q: z.infer<typeof rfqListQuery>) {
    return this.rfqs.list(auth, q);
  }

  @Get('stats')
  @RequirePermissions('rfq.read')
  stats(@CurrentAuth() auth: AuthContext) {
    return this.rfqs.stats(auth);
  }

  @Post()
  @RequirePermissions('rfq.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(zod(rfqSchema)) body: z.infer<typeof rfqSchema>) {
    return this.rfqs.create(auth, body);
  }

  @Get(':id')
  @RequirePermissions('rfq.read')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.detail(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('rfq.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateRfqSchema)) body: z.infer<typeof updateRfqSchema>) {
    return this.rfqs.update(auth, id, body);
  }

  @Post(':id/submit-for-approval')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  submitForApproval(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.submitForApproval(auth, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  approve(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(optionalReason)) body: z.infer<typeof optionalReason>) {
    return this.rfqs.approve(auth, id, body.reason);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  send(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.send(auth, id);
  }

  @Post(':id/invitations')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  invite(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(inviteVendorsSchema)) body: z.infer<typeof inviteVendorsSchema>) {
    return this.rfqs.invite(auth, id, body.vendorIds);
  }

  @Post(':id/invitations/:invitationId/withdraw')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  withdrawInvitation(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body(zod(reason)) body: z.infer<typeof reason>,
  ) {
    return this.rfqs.withdrawInvitation(auth, id, invitationId, body.reason);
  }

  @Post(':id/invitations/:invitationId/decline')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body(zod(declineInvitationSchema)) body: z.infer<typeof declineInvitationSchema>,
  ) {
    return this.rfqs.recordDecline(auth, id, invitationId, body.reason);
  }

  @Post(':id/reminders')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  remind(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(reminderSchema)) body: z.infer<typeof reminderSchema>) {
    return this.rfqs.remind(auth, id, body.invitationIds, body.message);
  }

  @Post(':id/extend-deadline')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  extend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(extendDeadlineSchema)) body: z.infer<typeof extendDeadlineSchema>,
  ) {
    return this.rfqs.extendDeadline(auth, id, body.responseDeadline, body.reason);
  }

  @Post(':id/start-evaluation')
  @HttpCode(200)
  @RequirePermissions('quotation.read')
  startEvaluation(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rfqs.startEvaluation(auth, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(reason)) body: z.infer<typeof reason>) {
    return this.rfqs.cancel(auth, id, body.reason);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('rfq.manage')
  close(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(reason)) body: z.infer<typeof reason>) {
    return this.rfqs.close(auth, id, body.reason);
  }

  @Post(':id/attachments')
  @RequirePermissions('rfq.manage', 'document.upload')
  @UseInterceptors(upload)
  attach(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'Attach a file' }]);
    return this.rfqs.addAttachment(auth, id, file);
  }

  // ── Quotations under an RFQ ─────────────────────────────────────────────
  @Get(':id/quotations')
  @RequirePermissions('quotation.read')
  quotations_(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.listForRfq(auth, id);
  }

  @Get(':id/comparison')
  @RequirePermissions('quotation.read')
  comparison(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.comparison(auth, id);
  }

  @Get(':id/comparison/report')
  @RequirePermissions('quotation.read')
  async comparisonReport(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zod(reportFormat)) q: z.infer<typeof reportFormat>,
    @Res() res: Response,
  ) {
    sendReport(res, await this.reports.comparison(auth, id, q.format));
  }

  @Post(':id/quotations')
  @RequirePermissions('quotation.manage')
  register(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(createQuotationSchema)) body: z.infer<typeof createQuotationSchema>,
  ) {
    return this.quotations.register(auth, id, body);
  }
}

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get(':id')
  @RequirePermissions('quotation.read')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.detail(auth, id);
  }

  @Patch(':id/draft')
  @RequirePermissions('quotation.manage')
  updateDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(quotationVersionSchema)) body: z.infer<typeof quotationVersionSchema>,
  ) {
    return this.quotations.updateDraft(auth, id, body);
  }

  @Post(':id/draft/submit')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  submitDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(submitQuotationVersionSchema)) body: z.infer<typeof submitQuotationVersionSchema>,
  ) {
    return this.quotations.submitDraft(auth, id, body.changeSummary, body.lateAcceptanceReason);
  }

  @Delete(':id/draft')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  discardDraft(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotations.discardDraft(auth, id);
  }

  @Post(':id/revisions')
  @RequirePermissions('quotation.manage')
  revise(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(quotationVersionSchema)) body: z.infer<typeof quotationVersionSchema>,
  ) {
    return this.quotations.startRevision(auth, id, body);
  }

  @Post(':id/request-clarification')
  @HttpCode(200)
  @RequirePermissions('quotation.read')
  clarify(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(quotationActionSchema)) body: z.infer<typeof quotationActionSchema>,
  ) {
    return this.quotations.review(auth, id, 'REQUEST_CLARIFICATION', body.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('quotation.award')
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(quotationActionSchema)) body: z.infer<typeof quotationActionSchema>,
  ) {
    return this.quotations.review(auth, id, 'REJECT', body.note);
  }

  @Post(':id/notes')
  @HttpCode(200)
  @RequirePermissions('quotation.read')
  addNote(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(quotationActionSchema)) body: z.infer<typeof quotationActionSchema>,
  ) {
    return this.quotations.review(auth, id, 'NOTE', body.note);
  }

  @Post(':id/attachments')
  @RequirePermissions('quotation.manage', 'document.upload')
  @UseInterceptors(upload)
  attach(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'Attach a file' }]);
    return this.quotations.addAttachment(auth, id, file);
  }

  @Post('expire-lapsed')
  @HttpCode(200)
  @RequirePermissions('quotation.manage')
  expire(@CurrentAuth() auth: AuthContext) {
    return this.quotations.expireLapsed(auth.companyId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  bankChangeQueueQuery,
  bankChangeRequestSchema,
  createVendorSchema,
  duplicateCheckSchema,
  revealSchema,
  updateVendorSchema,
  vendorBankSchema,
  vendorContactSchema,
  vendorDocumentMetaSchema,
  vendorDocumentQueueQuery,
  vendorListQuery,
  vendorReasonSchema,
  vendorSubmitSchema,
  verifyVendorDocumentSchema,
} from '@kenzo/shared';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VendorBankService } from './vendor-bank.service';
import { VendorCommon } from './vendor-common';
import { VendorDocumentsService } from './vendor-documents.service';
import { VendorInsightsService } from './vendor-insights.service';
import { VendorsService } from './vendors.service';

const optionalReason = z.object({ reason: z.string().trim().max(1000).optional() });
const contactUpdateSchema = vendorContactSchema.partial();

@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly insights: VendorInsightsService,
    private readonly docs: VendorDocumentsService,
    private readonly bank: VendorBankService,
    private readonly common: VendorCommon,
    private readonly prisma: PrismaService,
  ) {}

  // ── Collection & static routes (declared before /:id) ────────────────────
  @Get()
  @RequirePermissions('vendor.read')
  list(@CurrentAuth() auth: AuthContext, @Query(zod(vendorListQuery)) q: z.infer<typeof vendorListQuery>) {
    return this.insights.list(auth, q);
  }

  @Get('stats')
  @RequirePermissions('vendor.read')
  stats(@CurrentAuth() auth: AuthContext) {
    return this.insights.stats(auth);
  }

  @Get('categories')
  @RequirePermissions('vendor.read')
  async categories(@CurrentAuth() auth: AuthContext) {
    const rows = await this.prisma.vendor.findMany({
      where: { companyId: auth.companyId },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return { items: rows.map((r) => r.category) };
  }

  @Post('duplicate-check')
  @HttpCode(200)
  @RequirePermissions('vendor.read')
  async duplicateCheck(@CurrentAuth() auth: AuthContext, @Body(zod(duplicateCheckSchema)) body: z.infer<typeof duplicateCheckSchema>) {
    return { matches: await this.common.findDuplicates(this.prisma, auth.companyId, body) };
  }

  @Get('documents/queue')
  @RequirePermissions('vendor.read')
  documentQueue(@CurrentAuth() auth: AuthContext, @Query(zod(vendorDocumentQueueQuery)) q: z.infer<typeof vendorDocumentQueueQuery>) {
    return this.docs.queue(auth, q);
  }

  @Post('documents/expiry-scan')
  @HttpCode(200)
  @RequirePermissions('vendor.approve')
  expiryScan(@CurrentAuth() auth: AuthContext) {
    return this.docs.runExpiryScan(auth.companyId);
  }

  @Get('bank-change-requests')
  @RequirePermissions('vendor.read')
  bankQueue(@CurrentAuth() auth: AuthContext, @Query(zod(bankChangeQueueQuery)) q: z.infer<typeof bankChangeQueueQuery>) {
    return this.bank.queue(auth, q.status);
  }

  @Post()
  @RequirePermissions('vendor.create')
  create(@CurrentAuth() auth: AuthContext, @Body(zod(createVendorSchema)) body: z.infer<typeof createVendorSchema>) {
    return this.vendors.create(auth, body);
  }

  // ── Single vendor ────────────────────────────────────────────────────────
  @Get(':id')
  @RequirePermissions('vendor.read')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.insights.vendor360(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('vendor.update')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateVendorSchema)) body: z.infer<typeof updateVendorSchema>) {
    return this.vendors.update(auth, id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('vendor.update')
  submit(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorSubmitSchema)) body: z.infer<typeof vendorSubmitSchema>) {
    return this.vendors.submit(auth, id, body.note);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @RequirePermissions('vendor.read')
  startReview(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.startReview(auth, id);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermissions('vendor.update')
  withdraw(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>) {
    return this.vendors.withdraw(auth, id, body.reason);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('vendor.approve')
  activate(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(optionalReason)) body: z.infer<typeof optionalReason>) {
    return this.vendors.activate(auth, id, body.reason);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('vendor.approve')
  suspend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>) {
    return this.vendors.suspend(auth, id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions('vendor.approve')
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>,
  ) {
    return this.vendors.reactivate(auth, id, body.reason);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('vendor.approve')
  archive(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>) {
    return this.vendors.archive(auth, id, body.reason);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('vendor.update')
  reopen(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>) {
    return this.vendors.reopen(auth, id, body.reason);
  }

  // ── Contacts ─────────────────────────────────────────────────────────────
  @Post(':id/contacts')
  @RequirePermissions('vendor.update')
  addContact(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(vendorContactSchema)) body: z.infer<typeof vendorContactSchema>,
  ) {
    return this.vendors.addContact(auth, id, body);
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions('vendor.update')
  updateContact(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(zod(contactUpdateSchema)) body: z.infer<typeof contactUpdateSchema>,
  ) {
    return this.vendors.updateContact(auth, id, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  @RequirePermissions('vendor.update')
  async removeContact(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    await this.vendors.removeContact(auth, id, contactId);
  }

  // ── Documents ────────────────────────────────────────────────────────────
  @Post(':id/documents')
  @RequirePermissions('vendor.update', 'document.upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().DOCUMENT_MAX_BYTES, files: 1, fields: 10 } }))
  async uploadDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(zod(vendorDocumentMetaSchema)) meta: z.infer<typeof vendorDocumentMetaSchema>,
  ) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'Attach the document file' }]);
    return this.docs.upload(auth, id, file, meta);
  }

  @Post(':id/documents/:documentId/verify')
  @HttpCode(200)
  @RequirePermissions('vendor.read')
  verifyDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body(zod(verifyVendorDocumentSchema)) body: z.infer<typeof verifyVendorDocumentSchema>,
  ) {
    return this.docs.verify(auth, id, documentId, body.decision, body.note);
  }

  // ── Bank details (restricted) ────────────────────────────────────────────
  @Post(':id/bank-account')
  @RequirePermissions('vendor.update')
  setOnboardingBank(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(vendorBankSchema)) body: z.infer<typeof vendorBankSchema>,
  ) {
    return this.bank.setOnboardingAccount(auth, id, body);
  }

  @Post(':id/bank-change-requests')
  @RequirePermissions('vendor.bank.update')
  requestBankChange(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(bankChangeRequestSchema)) body: z.infer<typeof bankChangeRequestSchema>,
  ) {
    return this.bank.requestChange(auth, id, body);
  }

  @Post(':id/bank-change-requests/:requestId/cancel')
  @HttpCode(204)
  @RequirePermissions('vendor.bank.update')
  async cancelBankChange(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(zod(vendorReasonSchema)) body: z.infer<typeof vendorReasonSchema>,
  ) {
    await this.bank.cancelChange(auth, id, requestId, body.reason);
  }

  @Post(':id/bank-accounts/:accountId/reveal')
  @HttpCode(200)
  @RequirePermissions('vendor.bank.read')
  revealAccount(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body(zod(revealSchema)) body: z.infer<typeof revealSchema>,
  ) {
    return this.bank.revealAccount(auth, id, accountId, body.reason);
  }

  @Post(':id/pan/reveal')
  @HttpCode(200)
  @RequirePermissions('vendor.bank.read')
  revealPan(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(revealSchema)) body: z.infer<typeof revealSchema>) {
    return this.bank.revealPan(auth, id, body.reason);
  }
}

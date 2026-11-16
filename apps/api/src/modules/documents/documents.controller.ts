import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { DocumentsService } from './documents.service';

const contentQuery = z.object({ exp: z.coerce.number().int(), sig: z.string().regex(/^[a-f0-9]{64}$/) });

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermissions('document.upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().DOCUMENT_MAX_BYTES, files: 1, fields: 5 } }))
  async upload(@CurrentAuth() auth: AuthContext, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw AppError.validation([{ path: 'file', message: 'Attach a file in the "file" field' }]);
    const doc = await this.documents.upload(auth, file);
    return {
      id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      sha256: doc.sha256,
      scanStatus: doc.scanStatus,
      createdAt: doc.createdAt,
    };
  }

  @Get(':id')
  async meta(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.documents.getAccessible(auth, id);
    const { objectKey: _objectKey, storageProvider: _provider, ...safe } = doc;
    return safe;
  }

  @Get(':id/download-url')
  downloadUrl(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.documents.signedUrl(auth, id);
  }

  @Get(':id/content')
  async content(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zod(contentQuery)) q: z.infer<typeof contentQuery>,
    @Res() res: Response,
  ) {
    const { doc, data } = await this.documents.readContent(auth, id, q.exp, q.sig);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.originalName)}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(data);
  }
}

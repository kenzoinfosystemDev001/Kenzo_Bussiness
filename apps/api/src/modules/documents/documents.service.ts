import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { ENV, type Env } from '../../config/env';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { hmacHex, safeEqual, sha256Hex } from '../../infrastructure/crypto/tokens';
import { PrismaService, type Db } from '../../infrastructure/prisma/prisma.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../infrastructure/storage/object-storage';
import { AuthorizationService } from '../access-control/authorization.service';
import { detectType, sanitizeFileName } from './file-type';

/** Lets a business module decide whether a user may read documents linked to its entities. */
export type DocumentLinkAccessResolver = (db: Db, auth: AuthContext, entityId: string) => Promise<boolean>;

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class DocumentsService {
  private readonly linkResolvers = new Map<string, DocumentLinkAccessResolver>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  registerLinkAccess(entityType: string, resolver: DocumentLinkAccessResolver): void {
    this.linkResolvers.set(entityType, resolver);
  }

  /**
   * Validates and stores an upload. The object key is random (never derived
   * from user input) and the original name is kept only as display metadata.
   */
  async upload(
    auth: AuthContext,
    file: { originalname: string; buffer: Buffer; size: number },
    link?: { entityType: string; entityId: string; linkType?: string },
  ): Promise<Document> {
    if (file.size > this.env.DOCUMENT_MAX_BYTES)
      throw new AppError('PAYLOAD_TOO_LARGE', `Files must be at most ${Math.floor(this.env.DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`);
    if (file.size === 0) throw AppError.validation([{ path: 'file', message: 'The file is empty' }]);
    const originalName = sanitizeFileName(file.originalname);
    const type = detectType(originalName, file.buffer);
    if (!type) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Unsupported or mismatched file type. Allowed: PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV.');

    const objectKey = `${auth.companyId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
    await this.storage.put(objectKey, file.buffer);
    try {
      return await this.prisma.tx(async (tx) => {
        const doc = await tx.document.create({
          data: {
            companyId: auth.companyId,
            storageProvider: this.storage.provider,
            objectKey,
            originalName,
            mimeType: type.mime,
            sizeBytes: file.size,
            sha256: sha256Hex(file.buffer),
            scanStatus: this.env.DOCUMENT_SCAN_MODE === 'none' ? 'SKIPPED' : 'PENDING',
            uploadedById: auth.userId,
          },
        });
        if (link) {
          await tx.documentLink.create({
            data: {
              documentId: doc.id,
              entityType: link.entityType,
              entityId: link.entityId,
              linkType: link.linkType ?? 'ATTACHMENT',
              createdById: auth.userId,
            },
          });
        }
        await this.audit.record(tx, {
          action: 'document.uploaded',
          entityType: 'document',
          entityId: doc.id,
          after: { originalName, mimeType: type.mime, sizeBytes: file.size, sha256: doc.sha256, link },
        });
        return doc;
      });
    } catch (err) {
      await this.storage.delete(objectKey).catch(() => undefined);
      throw err;
    }
  }

  async getAccessible(auth: AuthContext, id: string, db: Db = this.prisma) {
    const doc = await db.document.findFirst({
      where: { id, companyId: auth.companyId, deletedAt: null },
      include: { links: true, uploadedBy: { select: { id: true, fullName: true } } },
    });
    if (!doc) throw AppError.notFound('Document');
    if (this.authz.can(auth, 'document.read', { companyId: doc.companyId, ownerId: doc.uploadedById })) return doc;
    for (const link of doc.links) {
      const resolver = this.linkResolvers.get(link.entityType);
      if (resolver && (await resolver(db, auth, link.entityId))) return doc;
    }
    throw AppError.notFound('Document');
  }

  private signature(id: string, exp: number, userId: string): string {
    return hmacHex(this.env.SESSION_SECRET, `doc:${id}:${exp}:${userId}`);
  }

  /** Short-lived URL bound to the requesting user; the content route also requires their session. */
  async signedUrl(auth: AuthContext, id: string): Promise<{ url: string; expiresAt: string }> {
    const doc = await this.getAccessible(auth, id);
    this.assertDownloadable(doc);
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    return {
      url: `/api/v1/documents/${doc.id}/content?exp=${exp}&sig=${this.signature(doc.id, exp, auth.userId)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private assertDownloadable(doc: Document) {
    if (doc.scanStatus === 'INFECTED') throw AppError.invalidState('This file failed the malware scan and is quarantined');
    if (doc.scanStatus === 'PENDING' || doc.scanStatus === 'FAILED') throw AppError.invalidState('This file is awaiting a malware scan');
  }

  async readContent(auth: AuthContext, id: string, exp: number, sig: string): Promise<{ doc: Document; data: Buffer }> {
    if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000) || !safeEqual(sig, this.signature(id, exp, auth.userId))) {
      throw AppError.forbidden('This download link is invalid or has expired');
    }
    const doc = await this.getAccessible(auth, id);
    this.assertDownloadable(doc);
    const data = await this.storage.get(doc.objectKey);
    if (sha256Hex(data) !== doc.sha256) throw new AppError('INTERNAL_ERROR', 'Stored file failed its integrity check');
    await this.audit.record(this.prisma, { action: 'document.downloaded', entityType: 'document', entityId: doc.id });
    return { doc, data };
  }
}

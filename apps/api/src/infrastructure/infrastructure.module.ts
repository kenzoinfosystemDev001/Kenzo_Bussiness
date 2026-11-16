import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from '../config/env';
import { AuditService } from './audit/audit.service';
import { FieldEncryptionService } from './crypto/field-encryption.service';
import { MailService } from './mail/mail.service';
import { NotificationService } from './notifications/notification.service';
import { NumberingService } from './numbering/numbering.service';
import { OutboxService } from './outbox/outbox.service';
import { PrismaService } from './prisma/prisma.service';
import { LocalDiskStorage, OBJECT_STORAGE } from './storage/object-storage';

/**
 * Shared infrastructure available to every module: database, audit, outbox,
 * notifications, numbering, encryption and object storage.
 */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: loadEnv },
    PrismaService,
    AuditService,
    OutboxService,
    MailService,
    NotificationService,
    NumberingService,
    FieldEncryptionService,
    { provide: OBJECT_STORAGE, useClass: LocalDiskStorage },
  ],
  exports: [ENV, PrismaService, AuditService, OutboxService, MailService, NotificationService, NumberingService, FieldEncryptionService, OBJECT_STORAGE],
})
export class InfrastructureModule {}

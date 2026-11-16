import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { ENV, type Env } from '../../config/env';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { FieldEncryptionService } from '../../infrastructure/crypto/field-encryption.service';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '../../infrastructure/crypto/password-hasher';
import { generateToken, sha256Hex } from '../../infrastructure/crypto/tokens';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../infrastructure/crypto/totp';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessContextLoader } from '../access-control/access-context.loader';
import { SessionService } from './session.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface LoginResult {
  token: string;
  sessionId: string;
  mfaRequired: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly access: AccessContextLoader,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly crypto: FieldEncryptionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Password login. Failure responses are identical for unknown email, wrong
   * password and inactive accounts (no account enumeration); timing is
   * equalised with a dummy hash. Repeated failures lock the account temporarily.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const invalid = () => new AppError('INVALID_CREDENTIALS', 'Incorrect email or password');

    if (!user || !user.passwordHash) {
      await verifyPassword(password, await getDummyHash());
      await this.audit.recordSafely(this.prisma, {
        action: 'auth.login.failed',
        entityType: 'user',
        companyId: null,
        actorId: user?.id ?? null,
        outcome: 'FAILURE',
        after: { reason: user ? 'no_password' : 'unknown_email' },
      });
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.recordSafely(this.prisma, {
        action: 'auth.login.locked',
        entityType: 'user',
        entityId: user.id,
        companyId: user.companyId,
        actorId: user.id,
        outcome: 'DENIED',
      });
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or reset your password.');
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= this.env.LOGIN_MAX_FAILURES;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await this.audit.recordSafely(this.prisma, {
        action: lock ? 'auth.account.locked' : 'auth.login.failed',
        entityType: 'user',
        entityId: user.id,
        companyId: user.companyId,
        actorId: user.id,
        outcome: 'FAILURE',
        after: { failures },
      });
      throw invalid();
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.recordSafely(this.prisma, {
        action: 'auth.login.inactive',
        entityType: 'user',
        entityId: user.id,
        companyId: user.companyId,
        actorId: user.id,
        outcome: 'DENIED',
      });
      throw invalid();
    }

    const companyId = await this.pickCompany(user);
    if (!companyId) {
      await this.audit.recordSafely(this.prisma, {
        action: 'auth.login.no_access',
        entityType: 'user',
        entityId: user.id,
        companyId: user.companyId,
        actorId: user.id,
        outcome: 'DENIED',
      });
      throw new AppError('ACCOUNT_INACTIVE', 'Your account has no active access. Contact your administrator.');
    }

    const rehash = needsRehash(user.passwordHash) ? await hashPassword(password) : null;
    return this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: user.mfaEnabled ? user.lastLoginAt : new Date(),
          ...(rehash ? { passwordHash: rehash } : {}),
        },
      });
      const { token, session } = await this.sessions.create(tx, { userId: user.id, companyId, mfaPending: user.mfaEnabled });
      await this.audit.record(tx, {
        action: user.mfaEnabled ? 'auth.login.password_verified' : 'auth.login.succeeded',
        entityType: 'session',
        entityId: session.id,
        companyId,
        actorId: user.id,
      });
      return { token, sessionId: session.id, mfaRequired: user.mfaEnabled };
    });
  }

  private async pickCompany(user: User): Promise<string | null> {
    const companies = await this.access.accessibleCompanies(user.id);
    if (companies.length === 0) return null;
    return companies.find((c) => c.id === user.companyId)?.id ?? companies[0]!.id;
  }

  async logout(auth: Pick<AuthContext, 'sessionId' | 'userId' | 'companyId'>): Promise<void> {
    await this.prisma.tx(async (tx) => {
      await this.sessions.revoke(auth.sessionId, 'logout', tx);
      await this.audit.record(tx, { action: 'auth.logout', entityType: 'session', entityId: auth.sessionId });
    });
  }

  async switchCompany(auth: AuthContext, companyId: string): Promise<void> {
    const effective = await this.access.load(auth.userId, companyId);
    if (!effective) throw new AppError('COMPANY_ACCESS_DENIED', 'You do not have access to that company');
    await this.prisma.tx(async (tx) => {
      await tx.session.update({ where: { id: auth.sessionId }, data: { activeCompanyId: companyId } });
      await this.audit.record(tx, {
        action: 'auth.company.switched',
        entityType: 'session',
        entityId: auth.sessionId,
        companyId,
        before: { companyId: auth.companyId },
        after: { companyId },
      });
    });
  }

  // ── Password reset ────────────────────────────────────────────────────────

  /** Always succeeds from the caller's perspective (no account enumeration). */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      await this.audit.recordSafely(this.prisma, {
        action: 'auth.password_reset.requested_unknown',
        entityType: 'user',
        companyId: null,
        actorId: null,
        outcome: 'FAILURE',
      });
      return;
    }
    const token = generateToken();
    await this.prisma.tx(async (tx) => {
      // Only the newest reset link is valid.
      await tx.authToken.updateMany({ where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
      const record = await tx.authToken.create({
        data: { userId: user.id, type: 'PASSWORD_RESET', tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      await this.notifications.queueEmail(tx, {
        to: user.email,
        subject: 'Reset your Kenzo-Kore password',
        text: `Hello ${user.fullName},\n\nUse this link within 60 minutes to set a new password:\n${this.notifications.appUrl(`/reset-password?token=${token}`)}\n\nIf you did not request this, ignore this email — your password is unchanged.`,
        template: 'auth.password_reset',
        companyId: user.companyId,
        aggregateId: record.id,
      });
      await this.audit.record(tx, {
        action: 'auth.password_reset.requested',
        entityType: 'user',
        entityId: user.id,
        companyId: user.companyId,
        actorId: user.id,
      });
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.consumeToken(token, 'PASSWORD_RESET');
    const passwordHash = await hashPassword(password);
    await this.prisma.tx(async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new AppError('TOKEN_INVALID', 'This link is invalid or has expired');
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, version: { increment: 1 } },
      });
      const revoked = await this.sessions.revokeAllForUser(record.userId, 'password_reset', tx);
      await this.audit.record(tx, {
        action: 'auth.password_reset.completed',
        entityType: 'user',
        entityId: record.userId,
        companyId: record.user.companyId,
        actorId: record.userId,
        after: { sessionsRevoked: revoked },
      });
    });
  }

  async changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw AppError.validation([{ path: 'currentPassword', message: 'Current password is incorrect' }]);
    }
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw AppError.validation([{ path: 'newPassword', message: 'Choose a password different from the current one' }]);
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), version: { increment: 1 } } });
      const revoked = await this.sessions.revokeAllForUser(user.id, 'password_changed', tx, auth.sessionId);
      await this.audit.record(tx, { action: 'auth.password.changed', entityType: 'user', entityId: user.id, after: { otherSessionsRevoked: revoked } });
    });
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  async acceptInvitation(token: string, password: string, fullName?: string): Promise<void> {
    const record = await this.consumeToken(token, 'INVITATION');
    if (record.user.status !== 'INVITED') throw new AppError('TOKEN_INVALID', 'This invitation has already been used');
    const passwordHash = await hashPassword(password);
    await this.prisma.tx(async (tx) => {
      const claimed = await tx.authToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new AppError('TOKEN_INVALID', 'This invitation is invalid or has expired');
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'ACTIVE',
          activatedAt: new Date(),
          ...(fullName ? { fullName } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'user.invitation.accepted',
        entityType: 'user',
        entityId: record.userId,
        companyId: record.user.companyId,
        actorId: record.userId,
      });
    });
  }

  async describeToken(token: string, type: 'INVITATION' | 'PASSWORD_RESET'): Promise<{ email: string; fullName: string }> {
    const record = await this.consumeToken(token, type);
    return { email: record.user.email, fullName: record.user.fullName };
  }

  private async consumeToken(token: string, type: 'INVITATION' | 'PASSWORD_RESET') {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt <= new Date()) {
      throw new AppError('TOKEN_INVALID', 'This link is invalid or has expired');
    }
    return record;
  }

  // ── MFA (TOTP) ────────────────────────────────────────────────────────────

  async beginTotpEnrollment(auth: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.mfaEnabled) throw AppError.invalidState('Multi-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaPendingSecretEnc: this.crypto.encrypt(secret, `mfa:${user.id}`) } });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  async confirmTotpEnrollment(auth: AuthContext, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaPendingSecretEnc) throw AppError.invalidState('Start MFA enrolment first');
    const secret = this.crypto.decrypt(user.mfaPendingSecretEnc, `mfa:${user.id}`);
    if (!verifyTotp(secret, code)) throw new AppError('MFA_INVALID', 'The code is incorrect or expired');
    await this.prisma.tx(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, version: { increment: 1 } },
      });
      await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: new Date(), mfaPending: false } });
      await this.audit.record(tx, { action: 'auth.mfa.enabled', entityType: 'user', entityId: user.id });
    });
  }

  /** Second login step, or step-up verification for privileged actions. */
  async verifyTotp(auth: Pick<AuthContext, 'userId' | 'sessionId' | 'companyId'>, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) throw AppError.invalidState('Multi-factor authentication is not enabled');
    const secret = this.crypto.decrypt(user.mfaSecretEnc, `mfa:${user.id}`);
    if (!verifyTotp(secret, code)) {
      await this.audit.recordSafely(this.prisma, { action: 'auth.mfa.failed', entityType: 'user', entityId: user.id, outcome: 'FAILURE' });
      throw new AppError('MFA_INVALID', 'The code is incorrect or expired');
    }
    await this.prisma.tx(async (tx) => {
      await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: new Date(), mfaPending: false } });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, { action: 'auth.mfa.verified', entityType: 'session', entityId: auth.sessionId });
    });
  }

  async disableTotp(auth: AuthContext, code: string): Promise<void> {
    await this.verifyTotp(auth, code);
    await this.prisma.tx(async (tx) => {
      await tx.user.update({ where: { id: auth.userId }, data: { mfaEnabled: false, mfaSecretEnc: null, version: { increment: 1 } } });
      await tx.session.update({ where: { id: auth.sessionId }, data: { mfaVerifiedAt: null } });
      await this.audit.record(tx, { action: 'auth.mfa.disabled', entityType: 'user', entityId: auth.userId });
    });
  }
}

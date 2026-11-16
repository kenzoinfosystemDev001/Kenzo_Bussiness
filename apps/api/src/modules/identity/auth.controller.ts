import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISSIONS,
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  resetPasswordSchema,
  switchCompanySchema,
} from '@kenzo/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { AllowMfaPending, CurrentAuth, Public } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AccessContextLoader } from '../access-control/access-context.loader';
import { AuthService } from './auth.service';
import { CSRF_COOKIE, SESSION_COOKIE, SessionService } from './session.service';

const authLimit = { default: { limit: () => loadEnv().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } };
const describeTokenSchema = z.object({ token: z.string().min(20).max(200), type: z.enum(['INVITATION', 'PASSWORD_RESET']) });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly access: AccessContextLoader,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private setSessionCookies(res: Response, token: string, sessionId: string): string {
    const csrf = this.sessions.csrfTokenFor(sessionId);
    res.cookie(SESSION_COOKIE, token, this.sessions.cookieOptions('session'));
    res.cookie(CSRF_COOKIE, csrf, this.sessions.cookieOptions('csrf'));
    return csrf;
  }

  private clearCookies(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Public()
  @Throttle(authLimit)
  @Post('login')
  @HttpCode(200)
  async login(@Body(zod(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password);
    const csrfToken = this.setSessionCookies(res, result.token, result.sessionId);
    return { mfaRequired: result.mfaRequired, csrfToken };
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(auth);
    this.clearCookies(res);
  }

  @AllowMfaPending()
  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    const [user, company, companies] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { id: true, email: true, fullName: true, jobTitle: true, departmentId: true, mfaEnabled: true, lastLoginAt: true, passwordChangedAt: true },
      }),
      this.prisma.company.findUnique({
        where: { id: auth.companyId },
        select: { id: true, code: true, displayName: true, legalName: true, baseCurrency: true, timezone: true, enforceMfaForPrivileged: true },
      }),
      this.access.accessibleCompanies(auth.userId),
    ]);
    return {
      user,
      company,
      companies,
      roleKeys: auth.roleKeys,
      permissions: Object.fromEntries(auth.permissions),
      mfa: { enabled: auth.mfaEnabled, verified: auth.mfaVerified, pending: auth.mfaPending, enforced: auth.companyEnforcesMfa },
      csrfToken: this.sessions.csrfTokenFor(auth.sessionId),
      privilegedPermissions: Object.entries(PERMISSIONS)
        .filter(([, d]) => (d as { requiresMfa?: boolean }).requiresMfa)
        .map(([k]) => k),
    };
  }

  @Post('switch-company')
  @HttpCode(204)
  async switchCompany(@CurrentAuth() auth: AuthContext, @Body(zod(switchCompanySchema)) body: z.infer<typeof switchCompanySchema>) {
    await this.auth.switchCompany(auth, body.companyId);
  }

  // ── MFA ──────────────────────────────────────────────────────────────────
  @AllowMfaPending()
  @Throttle(authLimit)
  @Post('mfa/verify')
  @HttpCode(204)
  async verifyMfa(@CurrentAuth() auth: AuthContext, @Body(zod(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    await this.auth.verifyTotp(auth, body.code);
  }

  @Post('mfa/totp/setup')
  async setupTotp(@CurrentAuth() auth: AuthContext) {
    return this.auth.beginTotpEnrollment(auth);
  }

  @Throttle(authLimit)
  @Post('mfa/totp/confirm')
  @HttpCode(204)
  async confirmTotp(@CurrentAuth() auth: AuthContext, @Body(zod(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    await this.auth.confirmTotpEnrollment(auth, body.code);
  }

  @Throttle(authLimit)
  @Post('mfa/totp/disable')
  @HttpCode(204)
  async disableTotp(@CurrentAuth() auth: AuthContext, @Body(zod(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    if (auth.companyEnforcesMfa) throw AppError.invalidState('Your company requires multi-factor authentication');
    await this.auth.disableTotp(auth, body.code);
  }

  // ── Passwords & invitations ─────────────────────────────────────────────
  @Public()
  @Throttle(authLimit)
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body(zod(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.requestPasswordReset(body.email);
    return { message: 'If an active account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle(authLimit)
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(zod(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Throttle(authLimit)
  @Post('password/change')
  @HttpCode(204)
  async change(@CurrentAuth() auth: AuthContext, @Body(zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(auth, body.currentPassword, body.newPassword);
  }

  @Public()
  @Throttle(authLimit)
  @Post('tokens/describe')
  @HttpCode(200)
  async describeToken(@Body(zod(describeTokenSchema)) body: z.infer<typeof describeTokenSchema>) {
    return this.auth.describeToken(body.token, body.type);
  }

  @Public()
  @Throttle(authLimit)
  @Post('invitations/accept')
  @HttpCode(204)
  async acceptInvitation(@Body(zod(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>) {
    await this.auth.acceptInvitation(body.token, body.password, body.fullName);
  }

  // ── Own sessions ─────────────────────────────────────────────────────────
  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext) {
    const rows = await this.prisma.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, lastSeenAt: true, ipAddress: true, userAgent: true, expiresAt: true, mfaVerifiedAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    return { items: rows.map((s) => ({ ...s, current: s.id === auth.sessionId })) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const session = await this.prisma.session.findFirst({ where: { id, userId: auth.userId } });
    if (!session) throw AppError.notFound('Session');
    await this.prisma.tx(async (tx) => {
      await this.sessions.revoke(id, 'user_revoked', tx);
      await this.audit.record(tx, { action: 'auth.session.revoked', entityType: 'session', entityId: id });
    });
  }

  @Post('sessions/revoke-others')
  async revokeOthers(@CurrentAuth() auth: AuthContext) {
    return this.prisma.tx(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(auth.userId, 'user_revoked_others', tx, auth.sessionId);
      await this.audit.record(tx, { action: 'auth.session.revoked_others', entityType: 'user', entityId: auth.userId, after: { revoked } });
      return { revoked };
    });
  }
}

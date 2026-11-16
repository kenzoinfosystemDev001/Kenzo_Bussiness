import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';
import { safeEqual } from '../../infrastructure/crypto/tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccessContextLoader } from '../../modules/access-control/access-context.loader';
import { CSRF_HEADER, SESSION_COOKIE, SessionService } from '../../modules/identity/session.service';
import { ALLOW_MFA_PENDING, IS_PUBLIC } from '../decorators/auth.decorators';
import { RequestContext } from '../context/request-context';
import { AppError } from '../errors/app-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: authentication, CSRF and MFA gate for every route.
 *
 * 1. Origin check — state-changing requests carrying an Origin header must come
 *    from APP_ORIGIN (blocks cross-site form/fetch posts, incl. login CSRF).
 * 2. Session — HttpOnly cookie → server-side session → active user.
 * 3. CSRF — authenticated state-changing requests must echo the session-bound
 *    CSRF token in the `x-csrf-token` header (double-submit, HMAC-bound).
 * 4. MFA — a password-only session of an MFA-enrolled user can reach only
 *    routes marked @AllowMfaPending until the TOTP step succeeds.
 * 5. Access — loads effective permissions for the session's active company.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly access: AccessContextLoader,
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    this.allowedOrigin = new URL(env.APP_ORIGIN).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false;
    const mutating = !SAFE_METHODS.has(req.method);

    if (mutating) {
      const origin = req.header('origin');
      if (origin && origin !== this.allowedOrigin) throw new AppError('CSRF_INVALID', 'Request origin is not allowed');
    }
    if (isPublic) return true;

    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    const resolved = await this.sessions.resolve(token);
    if ('error' in resolved) {
      throw new AppError(resolved.error === 'expired' ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
    }
    const { session } = resolved;

    if (session.user.status !== 'ACTIVE') {
      await this.sessions.revoke(session.id, 'user_inactive');
      throw new AppError('ACCOUNT_INACTIVE', 'This account is not active');
    }

    if (mutating) {
      const supplied = req.header(CSRF_HEADER) ?? '';
      if (!supplied || !safeEqual(supplied, this.sessions.csrfTokenFor(session.id))) {
        throw new AppError('CSRF_INVALID', 'Missing or invalid CSRF token');
      }
    }

    const allowMfaPending = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, targets) ?? false;
    if (session.mfaPending && !allowMfaPending) {
      throw new AppError('MFA_REQUIRED', 'Complete multi-factor verification to continue');
    }

    const [effective, company] = await Promise.all([
      this.access.load(session.userId, session.activeCompanyId),
      this.prisma.company.findUnique({ where: { id: session.activeCompanyId }, select: { enforceMfaForPrivileged: true, status: true } }),
    ]);

    RequestContext.setAuth({
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      fullName: session.user.fullName,
      companyId: session.activeCompanyId,
      homeCompanyId: session.user.companyId,
      departmentId: session.user.departmentId,
      // No active assignment (or company suspended) → authenticated but no permissions;
      // the user can still read /auth/me and switch to a company they can access.
      permissions: effective && company?.status === 'ACTIVE' ? effective.permissions : new Map(),
      roleKeys: effective?.roleKeys ?? [],
      departmentScopeIds: effective?.departmentScopeIds ?? [],
      mfaEnabled: session.user.mfaEnabled,
      mfaVerified: !!session.mfaVerifiedAt,
      mfaPending: session.mfaPending,
      companyEnforcesMfa: company?.enforceMfaForPrivileged ?? false,
    });
    return true;
  }
}

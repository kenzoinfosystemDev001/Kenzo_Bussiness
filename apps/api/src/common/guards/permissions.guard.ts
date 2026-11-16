import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@kenzo/shared';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../../modules/access-control/authorization.service';
import { REQUIRED_PERMISSIONS } from '../decorators/auth.decorators';
import { RequestContext } from '../context/request-context';
import { AppError } from '../errors/app-error';

/**
 * Coarse route-level permission gate. Denials of sensitive routes are audited
 * so repeated probing is visible (PRD §16.3 "alert on repeated authorization denials").
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true;
    const auth = RequestContext.get()?.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');

    const missing = required.filter((p) => !this.authz.has(auth, p));
    if (missing.length > 0) {
      const req = context.switchToHttp().getRequest<{ method: string; route?: { path?: string } }>();
      await this.audit.recordSafely(this.prisma, {
        action: 'authz.denied',
        entityType: 'route',
        entityId: null,
        outcome: 'DENIED',
        after: { method: req.method, route: req.route?.path, missing },
      });
      throw AppError.forbidden();
    }
    for (const p of required) this.authz.assertMfa(auth, p);
    return true;
  }
}

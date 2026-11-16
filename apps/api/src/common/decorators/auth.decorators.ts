import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@kenzo/shared';
import { AppError } from '../errors/app-error';
import { RequestContext, type AuthContext } from '../context/request-context';

export const IS_PUBLIC = 'kk:isPublic';
export const REQUIRED_PERMISSIONS = 'kk:requiredPermissions';
export const ALLOW_MFA_PENDING = 'kk:allowMfaPending';

/** Route needs no session (login, password reset, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route requires ALL listed permissions in the active company. This is the
 * coarse gate; services additionally enforce record-level scope via
 * AuthorizationService.assertCan().
 */
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Route is reachable by a session that has passed the password step but not MFA yet. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** Injects the authenticated principal; throws if the route is unauthenticated. */
export const CurrentAuth = createParamDecorator((_data: unknown, _ctx: ExecutionContext): AuthContext => {
  const auth = RequestContext.get()?.auth;
  if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
  return auth;
});

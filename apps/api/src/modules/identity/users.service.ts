import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SCOPE_RANK, isAdministrativePermission, isPermissionKey, type InviteUserInput } from '@kenzo/shared';
import type { AuthContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { cursorWhere, decodeCursor, pageOf } from '../../common/pagination';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { generateToken, sha256Hex } from '../../infrastructure/crypto/tokens';
import { NotificationService } from '../../infrastructure/notifications/notification.service';
import { PrismaService, type Tx } from '../../infrastructure/prisma/prisma.service';
import { AuthorizationService } from '../access-control/authorization.service';
import { INVITATION_TTL_MS } from './auth.service';
import { SessionService } from './session.service';

const USER_SELECT = {
  id: true,
  companyId: true,
  email: true,
  fullName: true,
  jobTitle: true,
  status: true,
  departmentId: true,
  managerId: true,
  mfaEnabled: true,
  lastLoginAt: true,
  activatedAt: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  department: { select: { id: true, code: true, name: true } },
  manager: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly sessions: SessionService,
  ) {}

  /** Users who belong to the active company: home company or holding an assignment there. */
  private memberWhere(companyId: string): Prisma.UserWhereInput {
    return { OR: [{ companyId }, { roleAssignments: { some: { companyId } } }] };
  }

  async list(
    auth: AuthContext,
    q: { cursor?: string; limit: number; q?: string; status?: 'INVITED' | 'ACTIVE' | 'DEACTIVATED'; departmentId?: string; roleId?: string },
  ) {
    const scope = auth.permissions.get('user.read');
    if (!scope) throw AppError.forbidden();
    const and: Prisma.UserWhereInput[] = [this.memberWhere(auth.companyId)];
    if (scope !== 'COMPANY') {
      and.push({ OR: [{ id: auth.userId }, { departmentId: { in: auth.departmentScopeIds } }] });
    }
    if (q.status) and.push({ status: q.status });
    if (q.departmentId) and.push({ departmentId: q.departmentId });
    if (q.roleId) and.push({ roleAssignments: { some: { roleId: q.roleId, companyId: auth.companyId, revokedAt: null } } });
    if (q.q) and.push({ OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q.toLowerCase() } }] });
    const cursor = decodeCursor(q.cursor);
    if (cursor) and.push(cursorWhere(cursor) as Prisma.UserWhereInput);

    const rows = await this.prisma.user.findMany({
      where: { AND: and },
      select: {
        ...USER_SELECT,
        roleAssignments: {
          where: { companyId: auth.companyId, revokedAt: null },
          select: { id: true, validUntil: true, role: { select: { id: true, key: true, name: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    return pageOf(rows, q.limit);
  }

  async get(auth: AuthContext, id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, ...this.memberWhere(auth.companyId) }, select: USER_SELECT });
    if (!user) throw AppError.notFound('User');
    this.authz.assertCan(auth, 'user.read', { companyId: auth.companyId, departmentId: user.departmentId, ownerId: user.id }, 'User');
    const [assignments, sessions] = await Promise.all([
      this.prisma.userRoleAssignment.findMany({
        where: { userId: id, companyId: auth.companyId },
        select: {
          id: true,
          validFrom: true,
          validUntil: true,
          revokedAt: true,
          createdAt: true,
          department: { select: { id: true, name: true } },
          role: { select: { id: true, key: true, name: true, isSystem: true } },
          grantedBy: { select: { id: true, fullName: true } },
        },
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      }),
      this.authz.has(auth, 'user.session.revoke')
        ? this.prisma.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } })
        : Promise.resolve(null),
    ]);
    return { ...user, roleAssignments: assignments, activeSessionCount: sessions };
  }

  private async assertInCompany(tx: Tx, companyId: string, ids: { departmentId?: string | null; managerId?: string | null }) {
    if (ids.departmentId) {
      const d = await tx.department.findFirst({ where: { id: ids.departmentId, companyId, isActive: true } });
      if (!d) throw AppError.validation([{ path: 'departmentId', message: 'Department not found' }]);
    }
    if (ids.managerId) {
      const m = await tx.user.findFirst({ where: { id: ids.managerId, ...this.memberWhere(companyId), status: 'ACTIVE' } });
      if (!m) throw AppError.validation([{ path: 'managerId', message: 'Manager not found' }]);
    }
  }

  async invite(auth: AuthContext, input: InviteUserInput) {
    if (input.roleAssignments.length > 0) this.authz.assertCan(auth, 'role.assign');
    const token = generateToken();
    const user = await this.prisma.tx(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      if (existing) throw new AppError('CONFLICT', 'A user with this email already exists');
      await this.assertInCompany(tx, auth.companyId, input);
      const created = await tx.user.create({
        data: {
          companyId: auth.companyId,
          email: input.email,
          fullName: input.fullName,
          jobTitle: input.jobTitle ?? null,
          departmentId: input.departmentId ?? null,
          managerId: input.managerId ?? null,
          status: 'INVITED',
          createdById: auth.userId,
          updatedById: auth.userId,
        },
      });
      for (const a of input.roleAssignments) {
        await this.createAssignment(tx, auth, created.id, a.roleId, a.departmentId ?? null, a.validUntil ? new Date(a.validUntil) : null);
      }
      await this.issueInvitation(tx, auth, created, token);
      await this.audit.record(tx, {
        action: 'user.invited',
        entityType: 'user',
        entityId: created.id,
        after: { email: created.email, fullName: created.fullName, departmentId: created.departmentId, roles: input.roleAssignments.map((r) => r.roleId) },
      });
      return created;
    });
    return this.get(auth, user.id);
  }

  async resendInvitation(auth: AuthContext, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId: auth.companyId } });
    if (!user) throw AppError.notFound('User');
    if (user.status !== 'INVITED') throw AppError.invalidState('Only pending invitations can be resent');
    await this.prisma.tx(async (tx) => {
      await tx.authToken.updateMany({ where: { userId, type: 'INVITATION', usedAt: null }, data: { usedAt: new Date() } });
      await this.issueInvitation(tx, auth, user, generateToken());
      await this.audit.record(tx, { action: 'user.invitation.resent', entityType: 'user', entityId: userId });
    });
  }

  private async issueInvitation(tx: Tx, auth: AuthContext, user: { id: string; email: string; fullName: string }, token: string) {
    const record = await tx.authToken.create({
      data: { userId: user.id, type: 'INVITATION', tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS), createdById: auth.userId },
    });
    const company = await tx.company.findUniqueOrThrow({ where: { id: auth.companyId }, select: { displayName: true } });
    await this.notifications.queueEmail(tx, {
      to: user.email,
      subject: `You're invited to Kenzo-Kore BusinessOS (${company.displayName})`,
      text: `Hello ${user.fullName},\n\n${auth.fullName} invited you to Kenzo-Kore BusinessOS for ${company.displayName}.\n\nSet your password within 72 hours:\n${this.notifications.appUrl(`/accept-invitation?token=${token}`)}\n`,
      template: 'user.invitation',
      companyId: auth.companyId,
      aggregateId: record.id,
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: { fullName?: string; jobTitle?: string | null; departmentId?: string | null; managerId?: string | null; version: number },
  ) {
    await this.prisma.tx(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, ...this.memberWhere(auth.companyId) } });
      if (!before) throw AppError.notFound('User');
      if (input.managerId === id) throw AppError.validation([{ path: 'managerId', message: 'A user cannot be their own manager' }]);
      await this.assertInCompany(tx, auth.companyId, input);
      const res = await tx.user.updateMany({
        where: { id, version: input.version },
        data: {
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw AppError.versionConflict();
      await this.audit.record(tx, {
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        before: { fullName: before.fullName, jobTitle: before.jobTitle, departmentId: before.departmentId, managerId: before.managerId },
        after: input,
      });
    });
    return this.get(auth, id);
  }

  async setStatus(auth: AuthContext, id: string, status: 'ACTIVE' | 'DEACTIVATED', reason: string) {
    if (id === auth.userId) throw AppError.invalidState('You cannot change the status of your own account');
    await this.prisma.tx(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, ...this.memberWhere(auth.companyId) } });
      if (!user) throw AppError.notFound('User');
      if (status === 'ACTIVE' && user.status !== 'DEACTIVATED') throw AppError.invalidState('Only deactivated users can be reactivated');
      if (status === 'DEACTIVATED' && user.status === 'DEACTIVATED') throw AppError.invalidState('User is already deactivated');
      await tx.user.update({
        where: { id },
        data: {
          status,
          ...(status === 'DEACTIVATED' ? { deactivatedAt: new Date() } : { deactivatedAt: null, failedLoginCount: 0, lockedUntil: null }),
          updatedById: auth.userId,
          version: { increment: 1 },
        },
      });
      let revoked = 0;
      if (status === 'DEACTIVATED') {
        revoked = await this.sessions.revokeAllForUser(id, 'user_deactivated', tx);
        await tx.authToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
      }
      await this.audit.record(tx, {
        action: status === 'ACTIVE' ? 'user.activated' : 'user.deactivated',
        entityType: 'user',
        entityId: id,
        before: { status: user.status },
        after: { status, sessionsRevoked: revoked },
        reason,
      });
    });
    return this.get(auth, id);
  }

  async revokeSessions(auth: AuthContext, id: string, reason: string) {
    const user = await this.prisma.user.findFirst({ where: { id, ...this.memberWhere(auth.companyId) } });
    if (!user) throw AppError.notFound('User');
    return this.prisma.tx(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(id, 'admin_revoked', tx, id === auth.userId ? auth.sessionId : undefined);
      await this.audit.record(tx, { action: 'user.sessions.revoked', entityType: 'user', entityId: id, after: { revoked }, reason });
      return { revoked };
    });
  }

  // ── Role assignments ──────────────────────────────────────────────────────

  /**
   * Anti-escalation rules:
   *  - nobody changes their own role assignments;
   *  - you can only grant a role whose ADMINISTRATIVE permissions you hold
   *    yourself at ≥ scope (so a Company Admin cannot mint a Super Admin).
   *    Business roles (requester, finance, procurement …) are assignable by any
   *    holder of role.assign; the grant is audited and record-level
   *    maker-checker rules still bind the grantee.
   */
  private async createAssignment(tx: Tx, auth: AuthContext, userId: string, roleId: string, departmentId: string | null, validUntil: Date | null) {
    if (userId === auth.userId) throw new AppError('SEGREGATION_OF_DUTIES', 'You cannot change your own role assignments');
    const role = await tx.role.findFirst({ where: { id: roleId, companyId: auth.companyId }, include: { permissions: true } });
    if (!role) throw AppError.validation([{ path: 'roleId', message: 'Role not found' }]);
    const beyond = role.permissions.filter((rp) => {
      if (!isPermissionKey(rp.permissionKey)) return true;
      if (!isAdministrativePermission(rp.permissionKey)) return false;
      const mine = auth.permissions.get(rp.permissionKey);
      return !mine || SCOPE_RANK[mine] < SCOPE_RANK[rp.scope];
    });
    if (beyond.length > 0) {
      throw new AppError('FORBIDDEN', `You cannot grant "${role.name}" because it includes administrative permissions you do not hold`, {
        details: { permissions: beyond.map((b) => b.permissionKey).slice(0, 20) },
      });
    }
    if (departmentId) {
      const d = await tx.department.findFirst({ where: { id: departmentId, companyId: auth.companyId } });
      if (!d) throw AppError.validation([{ path: 'departmentId', message: 'Department not found' }]);
    }
    if (validUntil && validUntil <= new Date()) throw AppError.validation([{ path: 'validUntil', message: 'Must be in the future' }]);
    const duplicate = await tx.userRoleAssignment.findFirst({
      where: { userId, roleId, companyId: auth.companyId, departmentId, revokedAt: null, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] },
    });
    if (duplicate) throw new AppError('CONFLICT', 'The user already holds this role');
    const assignment = await tx.userRoleAssignment.create({
      data: { companyId: auth.companyId, userId, roleId, departmentId, validUntil, grantedById: auth.userId },
    });
    await this.audit.record(tx, {
      action: 'role.assigned',
      entityType: 'user',
      entityId: userId,
      after: { assignmentId: assignment.id, roleKey: role.key, departmentId, validUntil },
    });
    return assignment;
  }

  async assignRole(auth: AuthContext, userId: string, input: { roleId: string; departmentId?: string | null; validUntil?: string | null }) {
    await this.prisma.tx(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, ...this.memberWhere(auth.companyId) } });
      if (!user) throw AppError.notFound('User');
      if (user.status === 'DEACTIVATED') throw AppError.invalidState('Reactivate the user before assigning roles');
      await this.createAssignment(tx, auth, userId, input.roleId, input.departmentId ?? null, input.validUntil ? new Date(input.validUntil) : null);
    });
    return this.get(auth, userId);
  }

  async revokeAssignment(auth: AuthContext, assignmentId: string, reason: string) {
    await this.prisma.tx(async (tx) => {
      const a = await tx.userRoleAssignment.findFirst({ where: { id: assignmentId, companyId: auth.companyId }, include: { role: true } });
      if (!a) throw AppError.notFound('Role assignment');
      if (a.userId === auth.userId) throw new AppError('SEGREGATION_OF_DUTIES', 'You cannot change your own role assignments');
      if (a.revokedAt) throw AppError.invalidState('This assignment is already revoked');
      if (a.role.key === 'SUPER_ADMIN') {
        const remaining = await tx.userRoleAssignment.count({
          where: { companyId: auth.companyId, role: { key: 'SUPER_ADMIN' }, revokedAt: null, id: { not: a.id }, user: { status: 'ACTIVE' } },
        });
        if (remaining === 0) throw AppError.invalidState('A company must keep at least one active Super Admin');
      }
      await tx.userRoleAssignment.update({ where: { id: a.id }, data: { revokedAt: new Date(), revokedById: auth.userId } });
      await this.audit.record(tx, {
        action: 'role.revoked',
        entityType: 'user',
        entityId: a.userId,
        before: { assignmentId: a.id, roleKey: a.role.key, departmentId: a.departmentId },
        reason,
      });
    });
  }
}

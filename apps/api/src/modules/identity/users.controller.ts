import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { inviteUserSchema, listUsersQuery, roleAssignmentInput, updateUserSchema, userStatusChangeSchema } from '@kenzo/shared';
import type { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  list(@CurrentAuth() auth: AuthContext, @Query(zod(listUsersQuery)) q: z.infer<typeof listUsersQuery>) {
    return this.users.list(auth, q);
  }

  @Get(':id')
  @RequirePermissions('user.read')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(auth, id);
  }

  @Post('invitations')
  @RequirePermissions('user.invite')
  invite(@CurrentAuth() auth: AuthContext, @Body(zod(inviteUserSchema)) body: z.infer<typeof inviteUserSchema>) {
    return this.users.invite(auth, body);
  }

  @Post(':id/invitation/resend')
  @HttpCode(204)
  @RequirePermissions('user.invite')
  async resend(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.resendInvitation(auth, id);
  }

  @Patch(':id')
  @RequirePermissions('user.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateUserSchema)) body: z.infer<typeof updateUserSchema>) {
    return this.users.update(auth, id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('user.manage')
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(userStatusChangeSchema)) body: z.infer<typeof userStatusChangeSchema>,
  ) {
    return this.users.setStatus(auth, id, 'DEACTIVATED', body.reason);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions('user.manage')
  activate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(userStatusChangeSchema)) body: z.infer<typeof userStatusChangeSchema>,
  ) {
    return this.users.setStatus(auth, id, 'ACTIVE', body.reason);
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @RequirePermissions('user.session.revoke')
  revokeSessions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(userStatusChangeSchema)) body: z.infer<typeof userStatusChangeSchema>,
  ) {
    return this.users.revokeSessions(auth, id, body.reason);
  }

  @Post(':id/role-assignments')
  @RequirePermissions('role.assign')
  assign(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(roleAssignmentInput)) body: z.infer<typeof roleAssignmentInput>) {
    return this.users.assignRole(auth, id, body);
  }

  @Post('role-assignments/:assignmentId/revoke')
  @HttpCode(204)
  @RequirePermissions('role.assign')
  async revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body(zod(userStatusChangeSchema)) body: z.infer<typeof userStatusChangeSchema>,
  ) {
    await this.users.revokeAssignment(auth, assignmentId, body.reason);
  }
}

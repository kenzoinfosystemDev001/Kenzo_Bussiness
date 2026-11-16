import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { createRoleSchema, updateRoleSchema } from '@kenzo/shared';
import type { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('role.read')
  catalogue() {
    return this.roles.catalogue();
  }

  @Get('roles')
  @RequirePermissions('role.read')
  list(@CurrentAuth() auth: AuthContext) {
    return this.roles.list(auth);
  }

  @Get('roles/:id')
  @RequirePermissions('role.read')
  get(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(auth, id);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  create(@CurrentAuth() auth: AuthContext, @Body(zod(createRoleSchema)) body: z.infer<typeof createRoleSchema>) {
    return this.roles.create(auth, body);
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  update(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body(zod(updateRoleSchema)) body: z.infer<typeof updateRoleSchema>) {
    return this.roles.update(auth, id, body);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermissions('role.manage')
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.roles.remove(auth, id);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { costCentreSchema, createCompanySchema, departmentSchema, updateCompanySchema, updateCostCentreSchema, updateDepartmentSchema } from '@kenzo/shared';
import type { z } from 'zod';
import { CurrentAuth, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { AuthContext } from '../../common/context/request-context';
import { zod } from '../../common/pipes/zod-validation.pipe';
import { OrganizationService } from './organization.service';

@Controller()
export class OrganizationController {
  constructor(private readonly org: OrganizationService) {}

  @Get('companies/current')
  @RequirePermissions('org.company.read')
  current(@CurrentAuth() auth: AuthContext) {
    return this.org.currentCompany(auth);
  }

  @Patch('companies/current')
  @RequirePermissions('org.company.manage')
  updateCurrent(@CurrentAuth() auth: AuthContext, @Body(zod(updateCompanySchema)) body: z.infer<typeof updateCompanySchema>) {
    return this.org.updateCompany(auth, body);
  }

  @Post('companies')
  @RequirePermissions('platform.company.create')
  create(@CurrentAuth() auth: AuthContext, @Body(zod(createCompanySchema)) body: z.infer<typeof createCompanySchema>) {
    return this.org.createCompany(auth, body);
  }

  @Get('departments')
  @RequirePermissions('org.department.read')
  departments(@CurrentAuth() auth: AuthContext) {
    return this.org.listDepartments(auth);
  }

  @Post('departments')
  @RequirePermissions('org.department.manage')
  createDepartment(@CurrentAuth() auth: AuthContext, @Body(zod(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    return this.org.createDepartment(auth, body);
  }

  @Patch('departments/:id')
  @RequirePermissions('org.department.manage')
  updateDepartment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateDepartmentSchema)) body: z.infer<typeof updateDepartmentSchema>,
  ) {
    return this.org.updateDepartment(auth, id, body);
  }

  @Get('cost-centres')
  @RequirePermissions('org.cost_centre.read')
  costCentres(@CurrentAuth() auth: AuthContext) {
    return this.org.listCostCentres(auth);
  }

  @Post('cost-centres')
  @RequirePermissions('org.cost_centre.manage')
  createCostCentre(@CurrentAuth() auth: AuthContext, @Body(zod(costCentreSchema)) body: z.infer<typeof costCentreSchema>) {
    return this.org.createCostCentre(auth, body);
  }

  @Patch('cost-centres/:id')
  @RequirePermissions('org.cost_centre.manage')
  updateCostCentre(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(updateCostCentreSchema)) body: z.infer<typeof updateCostCentreSchema>,
  ) {
    return this.org.updateCostCentre(auth, id, body);
  }
}

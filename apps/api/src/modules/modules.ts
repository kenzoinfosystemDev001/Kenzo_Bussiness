import { Global, Module } from '@nestjs/common';
import { AccessContextLoader } from './access-control/access-context.loader';
import { AuthorizationService } from './access-control/authorization.service';
import { RolesController } from './access-control/roles.controller';
import { RolesService } from './access-control/roles.service';
import { SegregationOfDutiesService } from './access-control/segregation-of-duties.service';
import { AuditController } from './audit/audit.controller';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { HealthController } from './health/health.controller';
import { AuthController } from './identity/auth.controller';
import { AuthService } from './identity/auth.service';
import { SessionService } from './identity/session.service';
import { UsersController } from './identity/users.controller';
import { UsersService } from './identity/users.service';
import { IntegrationsController } from './integrations/integrations.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NumberingController } from './numbering/numbering.controller';
import { CompanyProvisioningService } from './organization/company-provisioning.service';
import { OrganizationController } from './organization/organization.controller';
import { OrganizationService } from './organization/organization.service';
import { ApprovalEngine } from './workflow/approval-engine.service';
import { ApprovalHooksRegistry } from './workflow/approval-hooks';
import { ApprovalPolicyService } from './workflow/approval-policy.service';
import { ApprovalQueryService } from './workflow/approval-query.service';
import { ApproverResolver } from './workflow/approver-resolver';
import { WorkflowController } from './workflow/workflow.controller';
import { VendorBankService } from './vendors/vendor-bank.service';
import { VendorCommon } from './vendors/vendor-common';
import { VendorDocumentsService } from './vendors/vendor-documents.service';
import { VendorInsightsService } from './vendors/vendor-insights.service';
import { VendorsController } from './vendors/vendors.controller';
import { VendorsService } from './vendors/vendors.service';

/** Access control — authorization decisions and separation of duties. Exported to every module. */
@Global()
@Module({
  controllers: [RolesController],
  providers: [AccessContextLoader, AuthorizationService, SegregationOfDutiesService, RolesService],
  exports: [AccessContextLoader, AuthorizationService, SegregationOfDutiesService],
})
export class AccessControlModule {}

/** Identity — authentication, sessions, MFA, users and invitations. */
@Global()
@Module({
  controllers: [AuthController, UsersController],
  providers: [SessionService, AuthService, UsersService],
  exports: [SessionService],
})
export class IdentityModule {}

/** Organization — companies, departments, cost centres, provisioning. */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, CompanyProvisioningService],
  exports: [CompanyProvisioningService],
})
export class OrganizationModule {}

/**
 * Workflow — reusable approval engine. Business modules depend on the exported
 * ApprovalEngine (submit/cancel) and ApprovalHooksRegistry (outcome handlers);
 * the engine never imports business modules.
 */
@Global()
@Module({
  controllers: [WorkflowController],
  providers: [ApproverResolver, ApprovalPolicyService, ApprovalEngine, ApprovalQueryService, ApprovalHooksRegistry],
  exports: [ApprovalEngine, ApprovalHooksRegistry],
})
export class WorkflowModule {}

/** Documents — metadata, validation, private storage and signed downloads. */
@Global()
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}

@Module({ controllers: [AuditController, NotificationsController, NumberingController, IntegrationsController, HealthController] })
export class PlatformModule {}

/**
 * Vendors (Phase 02) — vendor master, onboarding lifecycle, documents, restricted
 * bank details and Vendor 360. Depends on workflow (approval engine + hooks),
 * documents and access-control; nothing depends on it yet.
 */
@Module({
  controllers: [VendorsController],
  providers: [VendorCommon, VendorsService, VendorDocumentsService, VendorBankService, VendorInsightsService],
  exports: [VendorsService],
})
export class VendorsModule {}

import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from './config/env';
import { RequestContextMiddleware } from './common/context/request-context.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AccessControlModule, DocumentsModule, IdentityModule, OrganizationModule, PlatformModule, VendorsModule, WorkflowModule } from './modules/modules';

@Module({
  imports: [
    // In-memory store: per-instance limits. Use a Redis store when running >1 API replica.
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: () => loadEnv().RATE_LIMIT_PER_MINUTE }] }),
    InfrastructureModule,
    AccessControlModule,
    IdentityModule,
    OrganizationModule,
    WorkflowModule,
    DocumentsModule,
    PlatformModule,
    VendorsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: rate limit → authenticate (+CSRF/MFA) → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {
  AuthMiddleware,
  PermissionGuard,
  ProblemDetailsFilter,
} from './common';
import { OrgModule } from './org/org.module';
import { OrgController } from './org/org.controller';
import { IdentityModule } from './identity/identity.module';
import { ProductModule } from './product/product.module';
import { ProductController } from './product/product.controller';
import { SbomModule } from './sbom/sbom.module';
import { SbomController } from './sbom/sbom.controller';
import { VulnModule } from './vuln/vuln.module';
import { TriageModule } from './triage/triage.module';
import { TriageController } from './triage/triage.controller';
import { EvidenceModule } from './evidence/evidence.module';
import { EvidenceController } from './evidence/evidence.controller';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { JobsModule } from './jobs/jobs.module';
import { WorkflowModule } from './workflow/workflow.module';
import { ObligationController } from './workflow/obligation.controller';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnalyticsController } from './analytics/analytics.controller';
import { IntegrationModule } from './integration/integration.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    IdentityModule,
    AuditModule,
    StorageModule,
    JobsModule,
    OrgModule,
    ProductModule,
    SbomModule,
    VulnModule,
    TriageModule,
    EvidenceModule,
    WorkflowModule,
    AnalyticsModule,
    IntegrationModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // FR-IAM-002: authorisation enforced globally on every request.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // RFC 9457 Problem Details for every error (SEC-015: no internal leaks).
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Resolve identity + active-org principal + ALS context for domain controllers.
    consumer
      .apply(AuthMiddleware)
      .forRoutes(
        OrgController,
        ProductController,
        SbomController,
        TriageController,
        ObligationController,
        AnalyticsController,
        EvidenceController,
      );
  }
}

import { MODULE_METADATA } from "@nestjs/common/constants";

import { VULNERABILITY_REACHABILITY_INGESTION_REPOSITORY } from "./application/vulnerability-reachability-ingestion.port";
import {
  VULNERABILITY_FINDING_REVIEW_NOTIFICATION_QUEUE,
  VULNERABILITY_FINDING_REVIEW_NOTIFIER,
} from "./application/vulnerability-finding-review-notification.port";
import { VulnerabilityReachabilityIngestionUseCases } from "./application/vulnerability-reachability-ingestion-use-cases";
import { SupabaseVulnerabilityReachabilityIngestionRepository } from "./infrastructure/supabase-vulnerability-reachability-ingestion.repository";
import { SupabaseVulnerabilityFindingReviewNotificationQueue } from "./infrastructure/supabase-vulnerability-finding-review-notification-queue";
import { MailVulnerabilityFindingReviewNotifierAdapter } from "./infrastructure/mail-vulnerability-finding-review-notifier.adapter";
import { VulnerabilityFindingReviewNotificationWorker } from "./worker/vulnerability-finding-review-notification-worker";
import { VulnerabilitiesModule } from "./vulnerabilities.module";

describe("VulnerabilitiesModule reachability ingestion", () => {
  it("binds the inward-owned adapter port to the Supabase implementation", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      VulnerabilitiesModule,
    ) as readonly unknown[];

    expect(providers).toContain(
      SupabaseVulnerabilityReachabilityIngestionRepository,
    );
    expect(providers).toContainEqual({
      provide: VULNERABILITY_REACHABILITY_INGESTION_REPOSITORY,
      useExisting: SupabaseVulnerabilityReachabilityIngestionRepository,
    });
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: VulnerabilityReachabilityIngestionUseCases,
        }),
      ]),
    );
  });

  it("binds the durable review-notification worker to inward-owned ports", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      VulnerabilitiesModule,
    ) as readonly unknown[];

    expect(providers).toContain(
      SupabaseVulnerabilityFindingReviewNotificationQueue,
    );
    expect(providers).toContain(MailVulnerabilityFindingReviewNotifierAdapter);
    expect(providers).toContainEqual({
      provide: VULNERABILITY_FINDING_REVIEW_NOTIFICATION_QUEUE,
      useExisting: SupabaseVulnerabilityFindingReviewNotificationQueue,
    });
    expect(providers).toContainEqual({
      provide: VULNERABILITY_FINDING_REVIEW_NOTIFIER,
      useExisting: MailVulnerabilityFindingReviewNotifierAdapter,
    });
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: VulnerabilityFindingReviewNotificationWorker,
        }),
      ]),
    );
  });
});

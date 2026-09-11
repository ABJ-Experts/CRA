import { MODULE_METADATA } from "@nestjs/common/constants";

import { VULNERABILITY_REACHABILITY_INGESTION_REPOSITORY } from "./application/vulnerability-reachability-ingestion.port";
import {
  VULNERABILITY_FINDING_REVIEW_NOTIFICATION_QUEUE,
  VULNERABILITY_FINDING_REVIEW_NOTIFIER,
} from "./application/vulnerability-finding-review-notification.port";
import {
  VULNERABILITY_TRIAGE_ALERT_NOTIFIER,
  VULNERABILITY_TRIAGE_ALERT_QUEUE,
} from "./application/vulnerability-triage-alert.port";
import { VulnerabilityReachabilityIngestionUseCases } from "./application/vulnerability-reachability-ingestion-use-cases";
import { SupabaseVulnerabilityReachabilityIngestionRepository } from "./infrastructure/supabase-vulnerability-reachability-ingestion.repository";
import { SupabaseVulnerabilityFindingReviewNotificationQueue } from "./infrastructure/supabase-vulnerability-finding-review-notification-queue";
import { MailVulnerabilityFindingReviewNotifierAdapter } from "./infrastructure/mail-vulnerability-finding-review-notifier.adapter";
import { MailVulnerabilityTriageAlertNotifierAdapter } from "./infrastructure/mail-vulnerability-triage-alert-notifier.adapter";
import { SupabaseVulnerabilityTriageAlertQueue } from "./infrastructure/supabase-vulnerability-triage-alert-queue";
import { VulnerabilityFindingReviewNotificationWorker } from "./worker/vulnerability-finding-review-notification-worker";
import { VulnerabilityTriageAlertWorker } from "./worker/vulnerability-triage-alert-worker";
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

  it("binds the durable triage-alert worker to its feature-local ports", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      VulnerabilitiesModule,
    ) as readonly unknown[];

    expect(providers).toContain(SupabaseVulnerabilityTriageAlertQueue);
    expect(providers).toContain(MailVulnerabilityTriageAlertNotifierAdapter);
    expect(providers).toContainEqual({
      provide: VULNERABILITY_TRIAGE_ALERT_QUEUE,
      useExisting: SupabaseVulnerabilityTriageAlertQueue,
    });
    expect(providers).toContainEqual({
      provide: VULNERABILITY_TRIAGE_ALERT_NOTIFIER,
      useExisting: MailVulnerabilityTriageAlertNotifierAdapter,
    });
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: VulnerabilityTriageAlertWorker }),
      ]),
    );
  });
});

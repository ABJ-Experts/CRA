import { randomUUID } from "node:crypto";

import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { SupabaseModule } from "../supabase/supabase.module";
import type {
  VulnerabilityFeedKey,
  VulnerabilityFeedProvider,
} from "./application/vulnerability-feed.port";
import {
  VULNERABILITY_MIRROR_REPOSITORY,
  type VulnerabilityMirrorRepository,
} from "./application/vulnerability-mirror.port";
import { VulnerabilityFeedUseCases } from "./application/vulnerability-feed-use-cases";
import {
  EpssVulnerabilityFeedProvider,
  GithubAdvisoryFeedProvider,
  KevVulnerabilityFeedProvider,
  NvdVulnerabilityFeedProvider,
  OsvVulnerabilityFeedProvider,
} from "./infrastructure/http-vulnerability-feed.providers";
import { SupabaseVulnerabilityFeedRepository } from "./infrastructure/supabase-vulnerability-feed.repository";
import { VulnerabilityFeedsController } from "./vulnerabilities.controller";
import {
  VULNERABILITY_MATCHING_REPOSITORY,
  type VulnerabilityMatchingRepository,
} from "./application/vulnerability-matching.port";
import { VulnerabilityMatchingUseCases } from "./application/vulnerability-matching-use-cases";
import { SupabaseVulnerabilityMatchingRepository } from "./infrastructure/supabase-vulnerability-matching.repository";
import { VulnerabilityMatchingController } from "./vulnerability-matching.controller";
import { VulnerabilityFeedWorker } from "./worker/vulnerability-feed-worker";
import { VulnerabilityMatchingWorker } from "./matching/worker/vulnerability-matching-worker";

export const VULNERABILITY_FEED_PROVIDERS = Symbol(
  "VULNERABILITY_FEED_PROVIDERS",
);

@Module({
  imports: [SupabaseModule],
  controllers: [VulnerabilityFeedsController, VulnerabilityMatchingController],
  providers: [
    SupabaseVulnerabilityFeedRepository,
    SupabaseVulnerabilityMatchingRepository,
    {
      provide: VULNERABILITY_MIRROR_REPOSITORY,
      useExisting: SupabaseVulnerabilityFeedRepository,
    },
    {
      provide: VULNERABILITY_FEED_PROVIDERS,
      useFactory: (config: ConfigService) => {
        const providers: VulnerabilityFeedProvider[] = [
          new NvdVulnerabilityFeedProvider(),
          new OsvVulnerabilityFeedProvider(),
          new KevVulnerabilityFeedProvider(),
          new EpssVulnerabilityFeedProvider(),
          new GithubAdvisoryFeedProvider(
            config.get<string>("GITHUB_ADVISORY_TOKEN"),
          ),
        ];
        return new Map(
          providers.map((provider) => [provider.feedKey, provider]),
        );
      },
      inject: [ConfigService],
    },
    {
      provide: VulnerabilityFeedUseCases,
      useFactory: (repository: VulnerabilityMirrorRepository) =>
        new VulnerabilityFeedUseCases(repository),
      inject: [VULNERABILITY_MIRROR_REPOSITORY],
    },
    {
      provide: VULNERABILITY_MATCHING_REPOSITORY,
      useExisting: SupabaseVulnerabilityMatchingRepository,
    },
    {
      provide: VulnerabilityMatchingUseCases,
      inject: [VULNERABILITY_MATCHING_REPOSITORY],
      useFactory: (repository: VulnerabilityMatchingRepository) =>
        new VulnerabilityMatchingUseCases(repository),
    },
    {
      provide: VulnerabilityFeedWorker,
      useFactory: (
        repository: VulnerabilityMirrorRepository,
        providers: ReadonlyMap<string, VulnerabilityFeedProvider>,
        config: ConfigService,
      ) =>
        new VulnerabilityFeedWorker({
          workerId: randomUUID(),
          leaseSeconds:
            config.get<number>("VULNERABILITY_FEED_LEASE_SECONDS") ?? 60,
          repository,
          providers,
          githubTokenConfigured: Boolean(
            config.get<string>("GITHUB_ADVISORY_TOKEN"),
          ),
          scheduleOverrides: scheduleOverrides(config),
        }),
      inject: [
        VULNERABILITY_MIRROR_REPOSITORY,
        VULNERABILITY_FEED_PROVIDERS,
        ConfigService,
      ],
    },
    {
      provide: VulnerabilityMatchingWorker,
      inject: [SupabaseVulnerabilityMatchingRepository, ConfigService],
      useFactory: (
        repository: SupabaseVulnerabilityMatchingRepository,
        config: ConfigService,
      ) =>
        new VulnerabilityMatchingWorker({
          workerId: randomUUID(),
          leaseSeconds:
            config.get<number>("VULNERABILITY_MATCH_LEASE_SECONDS") ?? 90,
          pageSize: config.get<number>("VULNERABILITY_MATCH_PAGE_SIZE") ?? 250,
          queue: repository,
        }),
    },
  ],
  exports: [VulnerabilityFeedWorker, VulnerabilityMatchingWorker],
})
export class VulnerabilitiesModule {}

function scheduleOverrides(
  config: ConfigService,
): ReadonlyMap<
  VulnerabilityFeedKey,
  Readonly<{ scheduleIntervalSeconds?: number; staleThresholdSeconds?: number }>
> {
  const names: ReadonlyArray<readonly [VulnerabilityFeedKey, string]> = [
    ["nvd", "NVD"],
    ["osv", "OSV"],
    ["cisa_kev", "CISA_KEV"],
    ["epss", "EPSS"],
    ["github_advisory", "GITHUB_ADVISORY"],
  ];
  return new Map(
    names.map(([feedKey, name]) => [
      feedKey,
      {
        scheduleIntervalSeconds: config.get<number>(
          `VULNERABILITY_${name}_SCHEDULE_INTERVAL_SECONDS`,
        ),
        staleThresholdSeconds: config.get<number>(
          `VULNERABILITY_${name}_STALE_THRESHOLD_SECONDS`,
        ),
      },
    ]),
  );
}

// The job handlers (BRD §14.1). Each one is a thin adapter over domain code that
// already exists and is already tested — the queue adds delivery, retry and
// scheduling, never business logic.
import { randomUUID } from 'node:crypto';
import { ingestSbom } from '../sbom';
import type { StorageProvider } from '../storage';
import {
  FetchFeedHttp,
  knownPackagesForOrganisation,
  matchRelease,
  reevaluateForAdvisories,
  syncFeed,
  type FeedSource,
} from '../vuln';
import { orgRecipients, tickObligations } from '../workflow';
import type { NotificationSender } from '../workflow';
import { listOrganisationIds } from '../db';
import {
  JOB,
  type FeedSyncPayload,
  type JobEnvelope,
  type NotificationDispatchPayload,
  type ObligationTickPayload,
  type SbomIngestPayload,
  type SbomMatchPayload,
  type ScheduleFanoutPayload,
  type VulnReevaluatePayload,
} from './job-catalogue';
import { enqueue, enqueueOnce, type HandlerSpec } from './queue';
import { fanOutPerTenant } from './scheduler';

export interface JobDeps {
  storage: StorageProvider;
  notifications: NotificationSender;
  feedSources: FeedSource[];
}

export function buildHandlers(deps: JobDeps): Record<string, HandlerSpec> {
  return {
    /** The one tenant-less job: expands a global heartbeat per organisation. */
    [JOB.SCHEDULE_FANOUT]: {
      requiresTenant: false,
      handler: async (raw) => {
        const p = raw as ScheduleFanoutPayload;
        const tenants = await fanOutPerTenant(p.target);
        return { target: p.target, tenants };
      },
    },

    /**
     * Ingest is idempotent on content hash inside ingestSbom itself, so a
     * redelivered job re-finds the existing document rather than duplicating it.
     * Matching is chained rather than inlined so a slow correlation pass cannot
     * hold an ingest slot (§14.1 gives them different concurrency for that reason).
     */
    [JOB.SBOM_INGEST]: {
      requiresTenant: true,
      handler: async (raw, envelope) => {
        const p = raw as SbomIngestPayload;
        const result = await ingestSbom(
          p.organisationId,
          envelope.actorId ?? p.organisationId,
          p.productReleaseId,
          p.document,
          deps.storage,
          p.source,
        );
        if (result.validationStatus !== 'invalid')
          await enqueue(JOB.SBOM_MATCH, {
            ...envelope,
            organisationId: p.organisationId,
            productReleaseId: p.productReleaseId,
          });
        return result;
      },
    },

    [JOB.SBOM_MATCH]: {
      requiresTenant: true,
      handler: async (raw, envelope) => {
        const p = raw as SbomMatchPayload;
        return matchRelease(
          p.organisationId,
          envelope.actorId ?? p.organisationId,
          p.productReleaseId,
        );
      },
    },

    /**
     * OSV is demand-seeded from one tenant's package set and therefore carries an
     * organisationId; KEV, EPSS, NVD and GHSA write the shared mirror and carry
     * none. Both go through syncFeed so checkpointing and staleness reporting are
     * identical (FR-VULN-002).
     */
    [JOB.FEED_SYNC]: {
      requiresTenant: false,
      handler: async (raw, envelope) => {
        const p = raw as FeedSyncPayload;
        const source = deps.feedSources.find((s) => s.key === p.feed);
        if (!source) throw new Error(`Unknown feed "${p.feed}"`);

        const result = await syncFeed(source, {
          http: new FetchFeedHttp(),
          knownPackages: () =>
            p.organisationId
              ? knownPackagesForOrganisation(p.organisationId)
              : Promise.resolve([]),
        });

        // FR-VULN-008: an advisory that actually changed has to reach releases
        // ingested weeks ago. Fanned out per tenant because re-matching runs
        // inside that tenant's RLS context.
        if (result.changedAdvisoryIds.length > 0) {
          const organisationIds = p.organisationId
            ? [p.organisationId]
            : await listOrganisationIds();
          for (const organisationId of organisationIds)
            await enqueue(JOB.VULN_REEVALUATE, {
              ...envelope,
              organisationId,
              advisoryIds: result.changedAdvisoryIds,
            });
        }

        // The feed said there is more behind this page; come straight back for it
        // rather than waiting for tomorrow's schedule.
        if (result.hasMore)
          await enqueue(JOB.FEED_SYNC, { ...envelope, feed: p.feed });

        return result;
      },
    },

    [JOB.VULN_REEVALUATE]: {
      requiresTenant: true,
      handler: async (raw, envelope) => {
        const p = raw as VulnReevaluatePayload;
        return reevaluateForAdvisories(
          p.organisationId,
          envelope.actorId ?? p.organisationId,
          p.advisoryIds,
        );
      },
    },

    /**
     * FR-SLA-005/006. The tick reads the clock itself and reconciles from the
     * database, so a worker that was down for an hour catches up on restart
     * rather than losing the thresholds it slept through.
     */
    [JOB.OBLIGATION_TICK]: {
      requiresTenant: true,
      handler: async (raw, envelope) => {
        const p = raw as ObligationTickPayload;
        const result = await tickObligations(p.organisationId, new Date());

        for (const notification of result.notifications) {
          const subject =
            notification.kind === 'overdue'
              ? `OVERDUE: ${notification.stage} reporting deadline has passed`
              : `Reporting deadline ${Math.round(notification.threshold * 100)}% elapsed — ${notification.stage}`;
          // FR-WF-008: a critical regulatory deadline notification cannot be
          // switched off by preference. Dispatch is a separate job so a broken
          // SMTP relay cannot roll back the tick that recorded the breach.
          await enqueue(JOB.NOTIFICATION_DISPATCH, {
            ...envelope,
            organisationId: p.organisationId,
            category: 'obligation_deadline',
            subject,
            body: `Obligation ${notification.obligationId}, stage ${notification.stage}, due ${notification.dueAt.toISOString()}.`,
            recipients: [],
          });
        }
        return result;
      },
    },

    [JOB.NOTIFICATION_DISPATCH]: {
      requiresTenant: true,
      handler: async (raw) => {
        const p = raw as NotificationDispatchPayload;
        // Resolved here rather than at enqueue time: membership may have changed
        // between the threshold being crossed and the message going out, and the
        // person who joined this morning is the one who needs to see it.
        const recipients =
          p.recipients.length > 0
            ? p.recipients
            : await orgRecipients(p.organisationId);
        await deps.notifications.send({
          organisationId: p.organisationId,
          category: p.category,
          subject: p.subject,
          body: p.body,
          recipients,
        });
        return { delivered: recipients.length };
      },
    },
  };
}

/** Convenience for producers outside the worker (the HTTP ingest path). */
export function envelopeFor(
  organisationId: string | null,
  actorId: string | null,
  correlationId = randomUUID(),
): JobEnvelope {
  return { organisationId, correlationId, actorId };
}

export { enqueue, enqueueOnce };

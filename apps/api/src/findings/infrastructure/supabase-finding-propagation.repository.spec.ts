import { FindingPropagationProviderError } from "../application/finding-propagation-use-cases";
import { SupabaseFindingPropagationRepository } from "./supabase-finding-propagation.repository";

const ids = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  actor: "22222222-2222-4222-8222-222222222222",
  product: "33333333-3333-4333-8333-333333333333",
  release: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  job: "66666666-6666-4666-8666-666666666666",
  key: "77777777-7777-4777-8777-777777777777",
  correlation: "88888888-8888-4888-8888-888888888888",
});
const at = "2026-08-14T11:00:00.000Z";

describe("SupabaseFindingPropagationRepository", () => {
  it("registers an opaque source through the tenant-first atomic RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "created",
          source: {
            id: ids.source,
            organizationId: ids.organization,
            status: "active",
            version: 0,
          },
          job_id: ids.job,
        },
      ],
      error: null,
    });
    const repository = repositoryFor(rpc);

    const result = await repository.registerSource(
      ids.organization,
      ids.actor,
      {
        sourceSystem: "sbom-correlation",
        sourceFindingKey: "opaque-finding-42",
        sourceProductId: ids.product,
        sourceReleaseId: ids.release,
        ruleVersion: "m2-v1",
        source: "SBOM correlation service",
        provenance: "Signed ingest batch",
        idempotencyKey: ids.key,
        correlationId: ids.correlation,
      },
    );

    expect(result).toEqual({
      outcome: "created",
      response: {
        source: {
          id: ids.source,
          organizationId: ids.organization,
          status: "active",
          version: 0,
        },
        jobId: ids.job,
        idempotent: false,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "register_finding_propagation_source_atomic",
      {
        p_organization_id: ids.organization,
        p_actor_user_id: ids.actor,
        p_source_system: "sbom-correlation",
        p_source_finding_key: "opaque-finding-42",
        p_source_product_id: ids.product,
        p_source_release_id: ids.release,
        p_source_baseline_revision_id: null,
        p_rule_version: "m2-v1",
        p_source: "SBOM correlation service",
        p_provenance: "Signed ingest batch",
        p_idempotency_key: ids.key,
        p_correlation_id: ids.correlation,
      },
    );
  });

  it("uses the member-verified aggregate RPC rather than selecting product tables", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          summary: {
            productId: ids.product,
            releaseId: ids.release,
            activeImpactCount: 1,
            supersededImpactCount: 0,
            closedImpactCount: 0,
            overrideCount: 0,
            latestGraphVersion: 3,
            latestEvaluatedAt: at,
            propagationState: "idle",
            queuedJobCount: 0,
            inProgressJobCount: 0,
            retryingJobCount: 0,
            deadLetterJobCount: 0,
          },
        },
      ],
      error: null,
    });

    const result = await repositoryFor(rpc).getProductImpactSummary(
      ids.organization,
      ids.actor,
      ids.product,
      ids.release,
    );

    expect(result).toMatchObject({ outcome: "found" });
    expect(rpc).toHaveBeenCalledWith("get_finding_product_impact_summary", {
      p_organization_id: ids.organization,
      p_product_id: ids.product,
      p_release_id: ids.release,
      p_actor_user_id: ids.actor,
    });
  });

  it("updates a source through its versioned, tenant-first command RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "updated",
          source: {
            id: ids.source,
            organizationId: ids.organization,
            status: "active",
            version: 3,
          },
          job_id: ids.job,
        },
      ],
      error: null,
    });

    await expect(
      repositoryFor(rpc).updateSource(ids.organization, ids.actor, ids.source, {
        sourceProductId: ids.product,
        sourceReleaseId: ids.release,
        ruleVersion: "m2-v2",
        status: "active",
        reason: "The release mapping was corrected after a signed SBOM review.",
        source: "SBOM correlation service",
        provenance: "Signed ingest batch 2026-08-14",
        expectedVersion: 2,
        idempotencyKey: ids.key,
        correlationId: ids.correlation,
      }),
    ).resolves.toEqual({
      outcome: "updated",
      response: {
        source: {
          id: ids.source,
          organizationId: ids.organization,
          status: "active",
          version: 3,
        },
        jobId: ids.job,
        idempotent: false,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "update_finding_propagation_source_atomic",
      {
        p_organization_id: ids.organization,
        p_source_id: ids.source,
        p_actor_user_id: ids.actor,
        p_source_product_id: ids.product,
        p_source_release_id: ids.release,
        p_source_baseline_revision_id: null,
        p_rule_version: "m2-v2",
        p_status: "active",
        p_reason:
          "The release mapping was corrected after a signed SBOM review.",
        p_source: "SBOM correlation service",
        p_provenance: "Signed ingest batch 2026-08-14",
        p_expected_version: 2,
        p_idempotency_key: ids.key,
        p_correlation_id: ids.correlation,
      },
    );
  });

  it("keeps a product-wide graph-event scope explicit when enqueueing one source page", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "enqueued_page",
          source_count: 4,
          next_cursor: null,
        },
      ],
      error: null,
    });

    await expect(
      repositoryFor(rpc).enqueueSourcePage({
        organizationId: ids.organization,
        eventId: ids.job,
        eventKey: "relationship.changed:1",
        graphVersion: 3,
        scopeKind: "product",
        sourceProductId: ids.product,
        correlationId: ids.correlation,
        occurredAt: at,
        asOf: at,
        cursor: null,
        pageSize: 100,
      }),
    ).resolves.toEqual({
      outcome: "enqueued_page",
      sourceCount: 4,
      nextCursor: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_finding_propagation_source_page_atomic",
      {
        p_organization_id: ids.organization,
        p_event_key: "relationship.changed:1",
        p_graph_version: 3,
        p_scope_kind: "product",
        p_source_product_id: ids.product,
        p_source_release_id: null,
        p_source_baseline_revision_id: null,
        p_as_of: at,
        p_cursor: null,
        p_page_size: 100,
      },
    );
  });

  it("maps the product graph stale-job transition to the SQL obsolete outcome", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "obsolete", checkpoint_version: 3 }],
      error: null,
    });

    await expect(
      repositoryFor(rpc).obsolete({
        organizationId: ids.organization,
        jobId: ids.job,
        workerId: ids.actor,
        checkpointVersion: 2,
        reason: "stale_graph",
      }),
    ).resolves.toEqual({ outcome: "obsolete" });
  });

  it("lists due organizations, claims a bounded job, and persists a final page through RPCs", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          { organization_id: ids.organization },
          { organization_id: ids.organization },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "claimed",
            job_id: ids.job,
            source_finding_id: ids.source,
            source_release_id: ids.release,
            source_baseline_revision_id: null,
            graph_version: 8,
            as_of: at,
            cursor: null,
            checkpoint_version: 3,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "completed" }],
        error: null,
      });
    const repository = repositoryFor(rpc);

    await expect(repository.dueOrganizationIds()).resolves.toEqual([
      ids.organization,
    ]);
    await expect(
      repository.claim({
        organizationId: ids.organization,
        workerId: ids.actor,
        leaseSeconds: 60,
      }),
    ).resolves.toMatchObject({
      outcome: "claimed",
      jobId: ids.job,
      sourceReleaseId: ids.release,
      checkpointVersion: 3,
    });
    await expect(
      repository.persistPage({
        organizationId: ids.organization,
        jobId: ids.job,
        leaseOwner: ids.actor,
        expectedCheckpointVersion: 3,
        candidates: [
          {
            productId: ids.product,
            releaseId: null,
            relationshipPathIds: [],
            graphVersion: 8,
            evaluatedAt: at,
          },
        ],
        nextCursor: null,
        isFinal: true,
      }),
    ).resolves.toEqual({ outcome: "completed" });
  });

  it("ends an override and maps durable retry/dead-letter transitions", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "ended",
            override: overrideRow({
              endedAt: at,
              endedBy: ids.actor,
              endReason: "The configuration exception is no longer required.",
              version: 1,
            }),
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "retry_scheduled" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "dead_letter" }],
        error: null,
      });
    const repository = repositoryFor(rpc);

    await expect(
      repository.endProductImpactOverride(
        ids.organization,
        ids.actor,
        ids.source,
        ids.product,
        ids.key,
        {
          expectedVersion: 0,
          reason: "The configuration exception is no longer required.",
          idempotencyKey: ids.key,
          correlationId: ids.correlation,
        },
      ),
    ).resolves.toMatchObject({ outcome: "ended" });
    await expect(
      repository.fail({
        organizationId: ids.organization,
        jobId: ids.job,
        workerId: ids.actor,
        checkpointVersion: 3,
        errorCode: "provider_unavailable",
        retryable: true,
      }),
    ).resolves.toEqual({ outcome: "retry_scheduled" });
    await expect(
      repository.fail({
        organizationId: ids.organization,
        jobId: ids.job,
        workerId: ids.actor,
        checkpointVersion: 4,
        errorCode: "malformed_payload",
        retryable: false,
      }),
    ).resolves.toEqual({ outcome: "dead_letter" });
  });

  it("rejects malformed worker inputs before issuing a provider request", async () => {
    const rpc = jest.fn();
    const repository = repositoryFor(rpc);

    await expect(
      repository.claim({
        organizationId: ids.organization,
        workerId: ids.actor,
        leaseSeconds: 0,
      }),
    ).resolves.toEqual({ outcome: "invalid_request" });
    await expect(
      repository.fail({
        organizationId: ids.organization,
        jobId: ids.job,
        workerId: ids.actor,
        checkpointVersion: 0,
        errorCode: "Not allowed",
        retryable: false,
      }),
    ).resolves.toEqual({ outcome: "invalid_request" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the provider returns an uncontracted success row", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "found", summary: { productId: ids.product } }],
      error: null,
    });

    await expect(
      repositoryFor(rpc).getProductImpactSummary(
        ids.organization,
        ids.actor,
        ids.product,
        null,
      ),
    ).rejects.toBeInstanceOf(FindingPropagationProviderError);
  });
});

function repositoryFor(rpc: jest.Mock): SupabaseFindingPropagationRepository {
  return new SupabaseFindingPropagationRepository({
    admin: () => ({ rpc }),
  } as never);
}

function overrideRow(
  overrides: Readonly<{
    endedAt: string | null;
    endedBy: string | null;
    endReason: string | null;
    version: number;
  }>,
) {
  return {
    id: ids.key,
    organizationId: ids.organization,
    sourceId: ids.source,
    affectedProductId: ids.product,
    affectedReleaseId: ids.release,
    overrideState: "not_applicable",
    reason: "The affected optional component is absent.",
    source: "Configuration review",
    provenance: "Approved configuration record",
    effectiveStartsAt: at,
    effectiveEndsAt: null,
    createdAt: at,
    createdBy: ids.actor,
    updatedAt: at,
    updatedBy: ids.actor,
    ...overrides,
  };
}

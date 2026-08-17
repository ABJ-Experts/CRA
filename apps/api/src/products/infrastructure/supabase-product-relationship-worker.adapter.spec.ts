import { SupabaseProductRelationshipWorkerAdapter } from "./supabase-product-relationship-worker.adapter";

describe("SupabaseProductRelationshipWorkerAdapter", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const workerId = "00000000-0000-4000-8000-000000000002";
  const eventId = "00000000-0000-4000-8000-000000000003";
  const productId = "00000000-0000-4000-8000-000000000004";
  const releaseId = "00000000-0000-4000-8000-000000000005";
  const baselineRevisionId = "00000000-0000-4000-8000-000000000006";

  type RpcCall = Readonly<{
    name: string;
    args: Readonly<Record<string, unknown>>;
  }>;

  function harness(rowsByProcedure: Readonly<Record<string, unknown>>) {
    const calls: RpcCall[] = [];
    const rpc = (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<{ data: unknown; error: null }> => {
      calls.push(Object.freeze({ name, args }));
      return Promise.resolve({ data: rowsByProcedure[name], error: null });
    };
    return {
      adapter: new SupabaseProductRelationshipWorkerAdapter({
        admin: () => ({ rpc }),
      } as never),
      calls,
    };
  }

  it("lists only valid due organization identifiers", async () => {
    const { adapter, calls } = harness({
      list_due_product_relationship_graph_event_organizations: [
        { organization_id: organizationId },
      ],
    });

    await expect(adapter.dueOrganizationIds()).resolves.toEqual([
      organizationId,
    ]);
    expect(calls).toEqual([
      {
        name: "list_due_product_relationship_graph_event_organizations",
        args: {},
      },
    ]);
  });

  it("rejects a malformed due-organization result", async () => {
    const { adapter } = harness({
      list_due_product_relationship_graph_event_organizations: [
        { organization_id: "not-a-uuid" },
      ],
    });

    await expect(adapter.dueOrganizationIds()).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("claims a graph event through its org-first lease RPC without exposing payload", async () => {
    const { adapter, calls } = harness({
      claim_product_relationship_graph_event_atomic: [
        {
          outcome: "claimed",
          event_id: eventId,
          organization_id: organizationId,
          graph_version: 3,
          event_key: "graph-change:1",
          checkpoint_version: 2,
          delivery_cursor: null,
          lease_owner: workerId,
          retry_count: 1,
        },
      ],
    });

    await expect(
      adapter.claim({ organizationId, workerId, leaseSeconds: 60 }),
    ).resolves.toEqual({
      outcome: "claimed",
      eventId,
      organizationId,
      graphVersion: 3,
      eventKey: "graph-change:1",
      checkpointVersion: 2,
      deliveryCursor: null,
      leaseOwner: workerId,
      retryCount: 1,
    });
    expect(calls[0]).toEqual({
      name: "claim_product_relationship_graph_event_atomic",
      args: {
        p_organization_id: organizationId,
        p_lease_owner: workerId,
        p_lease_seconds: 60,
      },
    });
  });

  it("describes a leased event as sanitized source scopes rather than returning outbox payload", async () => {
    const { adapter, calls } = harness({
      describe_product_relationship_graph_event_atomic: [
        {
          outcome: "found",
          event: {
            eventId,
            organizationId,
            graphVersion: 3,
            eventKey: "graph-change:1",
            occurredAt: "2026-08-14T10:00:00.000Z",
            deliveryCursor: null,
            sourceScopes: [
              {
                scopeKind: "release",
                sourceProductId: productId,
                sourceReleaseId: releaseId,
              },
              {
                scopeKind: "baseline",
                sourceProductId: productId,
                sourceBaselineRevisionId: baselineRevisionId,
              },
            ],
          },
        },
      ],
    });

    await expect(
      adapter.describe({
        organizationId,
        eventId,
        workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toEqual({
      outcome: "found",
      event: {
        eventId,
        organizationId,
        graphVersion: 3,
        eventKey: "graph-change:1",
        occurredAt: "2026-08-14T10:00:00.000Z",
        deliveryCursor: null,
        sourceScopes: [
          {
            scopeKind: "release",
            sourceProductId: productId,
            sourceReleaseId: releaseId,
          },
          {
            scopeKind: "baseline",
            sourceProductId: productId,
            sourceBaselineRevisionId: baselineRevisionId,
          },
        ],
      },
    });
    expect(calls[0]).toEqual({
      name: "describe_product_relationship_graph_event_atomic",
      args: {
        p_organization_id: organizationId,
        p_event_id: eventId,
        p_lease_owner: workerId,
        p_expected_checkpoint_version: 2,
      },
    });
  });

  it("acknowledges and retries events with their original org-scoped lease", async () => {
    const { adapter, calls } = harness({
      complete_product_relationship_graph_event_atomic: [
        { outcome: "completed" },
      ],
      fail_product_relationship_graph_event_atomic: [
        { outcome: "retry_scheduled" },
      ],
    });

    await expect(
      adapter.complete({
        organizationId,
        eventId,
        workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toEqual({ outcome: "completed" });
    await expect(
      adapter.fail({
        organizationId,
        eventId,
        workerId,
        checkpointVersion: 2,
        errorCode: "provider_unavailable",
        retryable: true,
      }),
    ).resolves.toEqual({ outcome: "retry_scheduled" });
    expect(calls).toEqual([
      {
        name: "complete_product_relationship_graph_event_atomic",
        args: {
          p_organization_id: organizationId,
          p_event_id: eventId,
          p_lease_owner: workerId,
          p_expected_checkpoint_version: 2,
        },
      },
      {
        name: "fail_product_relationship_graph_event_atomic",
        args: {
          p_organization_id: organizationId,
          p_event_id: eventId,
          p_lease_owner: workerId,
          p_expected_checkpoint_version: 2,
          p_error_code: "provider_unavailable",
          p_retryable: true,
        },
      },
    ]);
  });

  it("checkpoints a bounded source page before releasing the event lease", async () => {
    const { adapter, calls } = harness({
      checkpoint_product_relationship_graph_event_atomic: [
        { outcome: "scheduled" },
      ],
    });

    await expect(
      adapter.checkpoint({
        organizationId,
        eventId,
        workerId,
        checkpointVersion: 2,
        checkpoint: { deliveryCursor: `0:${productId}`, isFinal: false },
      }),
    ).resolves.toEqual({ outcome: "scheduled" });
    expect(calls).toEqual([
      {
        name: "checkpoint_product_relationship_graph_event_atomic",
        args: {
          p_organization_id: organizationId,
          p_event_id: eventId,
          p_lease_owner: workerId,
          p_expected_checkpoint_version: 2,
          p_delivery_cursor: `0:${productId}`,
          p_is_final: false,
        },
      },
    ]);
  });

  it("uses the system resolver without an interactive actor and parses the candidate page", async () => {
    const candidate = {
      productId,
      releaseId,
      relationshipPathIds: [eventId],
      graphVersion: 3,
      evaluatedAt: "2026-08-14T10:00:00.000Z",
    };
    const { adapter, calls } = harness({
      get_product_relationship_propagation_candidates_system: [
        {
          outcome: "found",
          candidates: {
            candidates: [candidate],
            nextCursor: null,
            graphVersion: 3,
            evaluatedAt: "2026-08-14T10:00:00.000Z",
          },
        },
      ],
    });

    await expect(
      adapter.getCandidatePage({
        organizationId,
        sourceReleaseId: releaseId,
        graphVersion: 3,
        pageSize: 25,
      }),
    ).resolves.toEqual({
      outcome: "found",
      candidates: [candidate],
      nextCursor: null,
      graphVersion: 3,
      evaluatedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(calls[0]).toEqual({
      name: "get_product_relationship_propagation_candidates_system",
      args: {
        p_organization_id: organizationId,
        p_source_release_id: releaseId,
        p_source_baseline_revision_id: null,
        p_graph_version: 3,
        p_as_of: null,
        p_page_size: 25,
        p_cursor: null,
      },
    });
    expect(calls[0]?.args).not.toHaveProperty("p_actor_user_id");
  });

  it("rejects malformed sanitized description instead of passing unparsed provider JSON onward", async () => {
    const { adapter } = harness({
      describe_product_relationship_graph_event_atomic: [
        {
          outcome: "found",
          event: {
            eventId,
            organizationId,
            graphVersion: 3,
            eventKey: "graph-change:1",
            occurredAt: "not-a-timestamp",
            deliveryCursor: null,
            sourceScopes: [],
            payload: { mustNotCrossTheBoundary: true },
          },
        },
      ],
    });

    await expect(
      adapter.describe({
        organizationId,
        eventId,
        workerId,
        checkpointVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });
});

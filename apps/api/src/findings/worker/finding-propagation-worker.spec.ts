import type {
  ProductRelationshipGraphEventWorkerPort,
  ProductRelationshipPropagationWorkerPort,
} from "../../products/application/product-relationship-worker.port";
import type { EnqueueFindingPropagationSourcePageInput } from "@repo/contracts/findings";
import {
  FindingPropagationWorker,
  type FindingPropagationWorkerDependencies,
} from "./finding-propagation-worker";

const ids = Object.freeze({
  organization: "11111111-1111-4111-8111-111111111111",
  secondOrganization: "12111111-1111-4111-8111-111111111111",
  worker: "22222222-2222-4222-8222-222222222222",
  event: "33333333-3333-4333-8333-333333333333",
  product: "44444444-4444-4444-8444-444444444444",
  release: "55555555-5555-4555-8555-555555555555",
  source: "66666666-6666-4666-8666-666666666666",
  job: "77777777-7777-4777-8777-777777777777",
  relationship: "88888888-8888-4888-8888-888888888888",
});
const timestamp = "2026-08-14T11:00:00.000Z";

const claimedEvent = (overrides: Record<string, unknown> = {}) => ({
  outcome: "claimed" as const,
  eventId: ids.event,
  organizationId: ids.organization,
  graphVersion: 8,
  eventKey: "relationship.changed:1",
  checkpointVersion: 3,
  deliveryCursor: null,
  leaseOwner: ids.worker,
  retryCount: 0,
  ...overrides,
});

describe("FindingPropagationWorker", () => {
  it("enqueues one product-scope source page then completes its graph event", async () => {
    const pageInputs: EnqueueFindingPropagationSourcePageInput[] = [];
    const enqueueSourcePage = jest.fn(
      (input: EnqueueFindingPropagationSourcePageInput) => {
        pageInputs.push(input);
        return Promise.resolve({
          outcome: "enqueued_page" as const,
          sourceCount: 1,
          nextCursor: null,
        });
      },
    );
    const checkpoint = jest.fn().mockResolvedValue({ outcome: "completed" });
    const dependencies = dependenciesFor({
      productEvents: {
        ...productEventsFor(),
        dueOrganizationIds: jest.fn().mockResolvedValue([ids.organization]),
        claim: jest
          .fn()
          .mockResolvedValueOnce(claimedEvent())
          .mockResolvedValueOnce({ outcome: "none_available" }),
        describe: jest.fn().mockResolvedValue(foundEvent("product")),
        checkpoint,
      },
      queue: { ...queueFor(), enqueueSourcePage },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(enqueueSourcePage).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKind: "product",
        sourceProductId: ids.product,
        cursor: null,
        pageSize: 100,
      }),
    );
    expect(pageInputs[0]).not.toHaveProperty("sourceReleaseId");
    expect(checkpoint).toHaveBeenCalledWith({
      organizationId: ids.organization,
      eventId: ids.event,
      workerId: ids.worker,
      checkpointVersion: 3,
      checkpoint: { deliveryCursor: null, isFinal: true },
    });
  });

  it("checkpoints each committed source page and replaying a page keeps the event key", async () => {
    const enqueueSourcePage = jest
      .fn()
      .mockResolvedValueOnce({
        outcome: "enqueued_page",
        sourceCount: 100,
        nextCursor: ids.source,
      })
      .mockResolvedValueOnce({
        outcome: "enqueued_page",
        sourceCount: 4,
        nextCursor: null,
      });
    const checkpoint = jest
      .fn()
      .mockResolvedValueOnce({ outcome: "scheduled" })
      .mockResolvedValueOnce({ outcome: "completed" });
    const dependencies = dependenciesFor({
      productEvents: {
        ...productEventsFor(),
        dueOrganizationIds: jest.fn().mockResolvedValue([ids.organization]),
        claim: jest
          .fn()
          .mockResolvedValueOnce(claimedEvent())
          .mockResolvedValueOnce(
            claimedEvent({
              deliveryCursor: `0:${ids.source}`,
              checkpointVersion: 4,
            }),
          )
          .mockResolvedValueOnce({ outcome: "none_available" }),
        describe: jest
          .fn()
          .mockResolvedValueOnce(foundEvent("release"))
          .mockResolvedValueOnce(
            foundEvent("release", ids.organization, `0:${ids.source}`),
          ),
        checkpoint,
      },
      queue: { ...queueFor(), enqueueSourcePage },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(enqueueSourcePage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventKey: "relationship.changed:1",
        cursor: null,
      }),
    );
    expect(enqueueSourcePage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventKey: "relationship.changed:1",
        cursor: ids.source,
      }),
    );
    expect(checkpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        checkpoint: { deliveryCursor: `0:${ids.source}`, isFinal: false },
      }),
    );
    expect(checkpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        checkpointVersion: 4,
        checkpoint: { deliveryCursor: null, isFinal: true },
      }),
    );
  });

  it("does not expand an event that the product boundary marks obsolete", async () => {
    const observe = jest.fn();
    const enqueueSourcePage = jest.fn();
    const dependencies = dependenciesFor({
      observe,
      productEvents: {
        ...productEventsFor(),
        dueOrganizationIds: jest.fn().mockResolvedValue([ids.organization]),
        claim: jest
          .fn()
          .mockResolvedValueOnce(claimedEvent())
          .mockResolvedValueOnce({ outcome: "none_available" }),
        describe: jest.fn().mockResolvedValue({ outcome: "obsolete" }),
      },
      queue: { ...queueFor(), enqueueSourcePage },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(enqueueSourcePage).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({
      metric: "stale_propagation",
      value: 1,
    });
  });

  it("processes one event per tenant before giving a tenant a second turn", async () => {
    const calls: string[] = [];
    const claimedByOrganization = new Map<string, number>();
    const dependencies = dependenciesFor({
      productEvents: {
        ...productEventsFor(),
        dueOrganizationIds: jest
          .fn()
          .mockResolvedValue([ids.secondOrganization, ids.organization]),
        claim: jest
          .fn()
          .mockImplementation(
            (command: Readonly<{ organizationId: string }>) => {
              const organizationId = command.organizationId;
              calls.push(organizationId);
              const claims = claimedByOrganization.get(organizationId) ?? 0;
              claimedByOrganization.set(organizationId, claims + 1);
              return Promise.resolve(
                claims === 0
                  ? claimedEvent({ organizationId })
                  : { outcome: "none_available" },
              );
            },
          ),
        describe: jest
          .fn()
          .mockImplementation((command: Readonly<{ organizationId: string }>) =>
            Promise.resolve(foundEvent("product", command.organizationId)),
          ),
      },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(calls.slice(0, 2)).toEqual([
      ids.organization,
      ids.secondOrganization,
    ]);
  });

  it("persists one bounded relationship page and finalizes only without a cursor", async () => {
    const persistPage = jest.fn().mockResolvedValue({ outcome: "completed" });
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    const getCandidatePage = jest.fn().mockResolvedValue({
      outcome: "found",
      candidates: [
        {
          productId: ids.product,
          releaseId: null,
          relationshipPathIds: [ids.relationship],
          graphVersion: 8,
          evaluatedAt: timestamp,
        },
      ],
      nextCursor: null,
      graphVersion: 8,
      evaluatedAt: timestamp,
    });
    const dependencies = dependenciesFor({
      queue: {
        ...queueFor(),
        dueOrganizationIds: jest.fn().mockResolvedValue([ids.organization]),
        claim: jest
          .fn()
          .mockResolvedValueOnce(claimedJob())
          .mockResolvedValueOnce({ outcome: "none_available" }),
        persistPage,
        fail,
      },
      relationships: {
        getCandidatePage,
      },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(getCandidatePage).toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(persistPage).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: ids.job,
        isFinal: true,
        nextCursor: null,
      }),
    );
  });

  it("marks a stale graph page obsolete so a newer event owns re-evaluation", async () => {
    const obsolete = jest.fn().mockResolvedValue({ outcome: "obsolete" });
    const dependencies = dependenciesFor({
      queue: {
        ...queueFor(),
        dueOrganizationIds: jest.fn().mockResolvedValue([ids.organization]),
        claim: jest
          .fn()
          .mockResolvedValueOnce(claimedJob())
          .mockResolvedValueOnce({ outcome: "none_available" }),
        obsolete,
      },
      relationships: {
        getCandidatePage: jest.fn().mockResolvedValue({ outcome: "conflict" }),
      },
    });

    await new FindingPropagationWorker(dependencies).runOnce();

    expect(obsolete).toHaveBeenCalledWith({
      organizationId: ids.organization,
      jobId: ids.job,
      workerId: ids.worker,
      checkpointVersion: 2,
      reason: "stale_graph",
    });
  });

  it("rejects invalid worker lease configuration at startup", () => {
    expect(
      () => new FindingPropagationWorker(dependenciesFor({ leaseSeconds: 0 })),
    ).toThrow("invalid finding propagation worker lease");
  });
});

function foundEvent(
  scopeKind: "product" | "release" | "baseline",
  organizationId: string = ids.organization,
  deliveryCursor: string | null = null,
) {
  const sourceScope =
    scopeKind === "product"
      ? { scopeKind, sourceProductId: ids.product }
      : scopeKind === "release"
        ? {
            scopeKind,
            sourceProductId: ids.product,
            sourceReleaseId: ids.release,
          }
        : {
            scopeKind,
            sourceProductId: ids.product,
            sourceBaselineRevisionId: ids.source,
          };
  return {
    outcome: "found" as const,
    event: {
      eventId: ids.event,
      organizationId,
      graphVersion: 8,
      eventKey: "relationship.changed:1",
      occurredAt: timestamp,
      deliveryCursor,
      sourceScopes: [sourceScope],
    },
  };
}

function claimedJob() {
  return {
    outcome: "claimed" as const,
    jobId: ids.job,
    organizationId: ids.organization,
    sourceId: ids.source,
    sourceReleaseId: ids.release,
    sourceBaselineRevisionId: null,
    graphVersion: 8,
    asOf: timestamp,
    cursor: null,
    checkpointVersion: 2,
  };
}

function queueFor(): FindingPropagationWorkerDependencies["queue"] {
  return {
    dueOrganizationIds: jest.fn().mockResolvedValue([]),
    claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
    enqueueSourcePage: jest.fn().mockResolvedValue({
      outcome: "enqueued_page",
      sourceCount: 0,
      nextCursor: null,
    }),
    persistPage: jest.fn().mockResolvedValue({ outcome: "completed" }),
    fail: jest.fn().mockResolvedValue({ outcome: "retry_scheduled" }),
    obsolete: jest.fn().mockResolvedValue({ outcome: "obsolete" }),
  };
}

function productEventsFor(): ProductRelationshipGraphEventWorkerPort {
  return {
    dueOrganizationIds: jest.fn().mockResolvedValue([]),
    claim: jest.fn().mockResolvedValue({ outcome: "none_available" }),
    describe: jest.fn(),
    checkpoint: jest.fn().mockResolvedValue({ outcome: "completed" }),
    complete: jest.fn(),
    fail: jest.fn().mockResolvedValue({ outcome: "retry_scheduled" }),
  };
}

function dependenciesFor(
  overrides: Partial<FindingPropagationWorkerDependencies> = {},
): FindingPropagationWorkerDependencies {
  return {
    workerId: ids.worker,
    leaseSeconds: 60,
    queue: queueFor(),
    productEvents: productEventsFor(),
    relationships: {
      getCandidatePage: jest.fn().mockResolvedValue({ outcome: "not_found" }),
    } satisfies ProductRelationshipPropagationWorkerPort,
    observe: jest.fn(),
    ...overrides,
  };
}

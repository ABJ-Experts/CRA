import { SupabaseProductComplianceWorkerAdapter } from "./supabase-product-compliance-worker.adapter";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const releaseId = "00000000-0000-4000-8000-000000000004";
const artifactId = "00000000-0000-4000-8000-000000000005";
const hash = "a".repeat(64);
const legacyObjectKey = `${organizationId}/${artifactId}/${hash}`;

describe("SupabaseProductComplianceWorkerAdapter", () => {
  it("uses the database-returned legacy object key when inspecting an existing artifact", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const storage = {
      inspect: jest.fn().mockResolvedValue({
        outcome: "verified",
        sha256: hash,
        byteSize: 1024,
        contentType: "application/octet-stream",
      }),
    };
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            if (name === "claim_product_security_update_artifact_work_atomic") {
              return Promise.resolve({
                data: [
                  {
                    outcome: "claimed",
                    delivery_id: "00000000-0000-4000-8000-000000000006",
                    lease_owner: "00000000-0000-4000-8000-000000000007",
                    checkpoint_version: 4,
                    artifact: artifactJson({
                      objectKey: legacyObjectKey,
                    }),
                  },
                ],
                error: null,
              });
            }
            return Promise.resolve({
              data: [{ outcome: "finalized", artifact: artifactJson() }],
              error: null,
            });
          },
        }),
      } as never,
      storage as never,
      {} as never,
    );

    const claimed = await adapter.queue.claim({
      organizationId,
      workerId: "00000000-0000-4000-8000-000000000007",
      leaseSeconds: 60,
    });

    expect(claimed).toMatchObject({
      outcome: "claimed",
      event: {
        kind: "inspect",
        organizationId,
        productId,
        artifactId,
        actorId,
        expectedVersion: 3,
        objectKey: legacyObjectKey,
      },
    });
    if (claimed.outcome !== "claimed" || claimed.event.kind !== "inspect") {
      throw new Error("expected inspection claim");
    }

    await expect(adapter.processor.inspect(claimed.event)).resolves.toEqual({
      outcome: "inspected",
    });
    expect(storage.inspect).toHaveBeenCalledWith({
      objectKey: legacyObjectKey,
      sha256: hash,
      byteSize: 1024,
      contentType: "application/octet-stream",
    });
    expect(calls.map((call) => call.name)).toEqual([
      "claim_product_security_update_artifact_work_atomic",
      "finalize_product_security_update_artifact_worker_atomic",
    ]);
  });

  it("treats a durable blocked availability recalculation as successfully handled", async () => {
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: () =>
            Promise.resolve({ data: [{ outcome: "blocked" }], error: null }),
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      adapter.processor.recalculate({
        organizationId,
        productId,
        artifactId,
        actorId,
        calculation: {
          ruleVersion: "m2.v2.security-update-availability.v1",
          availabilityUntil: null,
          issuedCandidate: null,
          supportCandidate: null,
          winningRule: null,
          computedAvailabilityUntil: null,
          nonReductionApplied: false,
          status: "incomplete",
          incompleteReasons: ["missing_support_period"],
        },
      }),
    ).resolves.toEqual({ outcome: "recalculated" });
  });

  it("inspects a server-validated external source with bounded hash, size, and type verification", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const storage = { inspect: jest.fn() };
    const externalReferences = {
      monitor: jest.fn().mockResolvedValue({ outcome: "verified" }),
    };
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            return Promise.resolve({
              data: [{ outcome: "finalized", artifact: artifactJson() }],
              error: null,
            });
          },
        }),
      } as never,
      storage as never,
      externalReferences as never,
    );

    await expect(
      adapter.processor.inspect({
        organizationId,
        productId,
        artifactId,
        actorId,
        expectedVersion: 3,
        sha256: hash,
        byteSize: 1024,
        contentType: "application/octet-stream",
        distributionKind: "external_reference",
        externalReferenceCandidates: [
          {
            id: "00000000-0000-4000-8000-000000000009",
            title: "Vendor package",
            uri: "https://updates.example.test/release",
          },
        ],
      }),
    ).resolves.toEqual({ outcome: "inspected" });
    expect(externalReferences.monitor).toHaveBeenCalledWith({
      candidates: [
        {
          id: "00000000-0000-4000-8000-000000000009",
          title: "Vendor package",
          uri: "https://updates.example.test/release",
        },
      ],
      sha256: hash,
      byteSize: 1024,
      contentType: "application/octet-stream",
    });
    expect(storage.inspect).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      name: "finalize_product_security_update_artifact_worker_atomic",
      args: {
        p_integrity_status: "verified",
        p_verified_sha256: hash,
        p_verified_byte_size: 1024,
        p_verified_content_type: "application/octet-stream",
      },
    });
  });

  it("performs a bounded safe external fetch before a durable monitor transition", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            return Promise.resolve({
              data: [{ outcome: "monitored" }],
              error: null,
            });
          },
        }),
      } as never,
      {} as never,
      {
        monitor: jest
          .fn()
          .mockResolvedValue({ outcome: "external_content_changed" }),
      } as never,
    );

    await expect(
      adapter.processor.monitorExternalReference({
        organizationId,
        productId,
        artifactId,
        actorId,
        expectedVersion: 3,
        sha256: hash,
        byteSize: 1024,
        externalReferenceCandidates: [
          {
            id: "00000000-0000-4000-8000-000000000008",
            title: "Vendor update",
            uri: "https://updates.example.test/release",
          },
        ],
      }),
    ).resolves.toEqual({ outcome: "monitored" });

    expect(calls[0]).toMatchObject({
      name: "monitor_security_update_external_reference_worker_atomic",
      args: {
        p_organization_id: organizationId,
        p_expected_version: 3,
        p_monitor_outcome: "external_content_changed",
      },
    });
  });

  it("turns a missing active worker actor into an observable retry instead of a completed job", async () => {
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: () =>
            Promise.resolve({
              data: [{ outcome: "retryable_unavailable" }],
              error: null,
            }),
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      adapter.processor.recalculate({
        organizationId,
        productId,
        artifactId,
        actorId,
        calculation: {
          ruleVersion: "m2.v2.security-update-availability.v1",
          availabilityUntil: null,
          issuedCandidate: null,
          supportCandidate: null,
          winningRule: null,
          computedAvailabilityUntil: null,
          nonReductionApplied: false,
          status: "incomplete",
          incompleteReasons: ["missing_support_period"],
        },
      }),
    ).rejects.toMatchObject({
      code: "worker_actor_unavailable",
      retryable: true,
    });
  });

  it("maps the metrics snapshot RPC into worker gauge measurements", async () => {
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: () =>
            Promise.resolve({
              data: [
                {
                  assessment_backlog: 2,
                  flagged_assessments: 1,
                  artifact_quarantine: 1,
                  artifact_hash_mismatch: 0,
                  artifact_provider_unavailable: 1,
                  artifact_upload_missing: 2,
                  artifact_upload_failed: 4,
                  artifact_expiring_availability: 0,
                  artifact_availability_blocked: 0,
                },
              ],
              error: null,
            }),
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(adapter.snapshotMetrics(organizationId)).resolves.toEqual([
      { metric: "review_backlog", value: 2 },
      { metric: "flagged_assessments", value: 1 },
      { metric: "quarantine", value: 1 },
      { metric: "hash_mismatch", value: 0 },
      { metric: "missing_object", value: 3 },
      { metric: "upload_failed", value: 4 },
      { metric: "expiring_availability", value: 0 },
      { metric: "availability_blocked", value: 0 },
    ]);
  });

  it("reverifies a still-intact private object and forwards the verified outcome", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const storage = {
      inspect: jest.fn().mockResolvedValue({
        outcome: "verified",
        sha256: hash,
        byteSize: 1024,
        contentType: "application/octet-stream",
      }),
    };
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            return Promise.resolve({
              data: [{ outcome: "reverified", artifact: artifactJson() }],
              error: null,
            });
          },
        }),
      } as never,
      storage as never,
      {} as never,
    );

    await expect(
      adapter.processor.reverify({
        organizationId,
        productId,
        artifactId,
        actorId,
        expectedVersion: 3,
        sha256: hash,
        byteSize: 1024,
        contentType: "application/octet-stream",
        objectKey: `${organizationId}/${hash}`,
      }),
    ).resolves.toEqual({ outcome: "reverified" });

    expect(storage.inspect).toHaveBeenCalledWith({
      objectKey: `${organizationId}/${hash}`,
      sha256: hash,
      byteSize: 1024,
      contentType: "application/octet-stream",
    });
    expect(calls[0]).toMatchObject({
      name: "reverify_security_update_artifact_worker_atomic",
      args: { p_expected_version: 3, p_verified_outcome: "verified" },
    });
  });

  it("reverifies a private object that has gone missing from storage", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const storage = {
      inspect: jest.fn().mockResolvedValue({ outcome: "missing" }),
    };
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            return Promise.resolve({
              data: [{ outcome: "reverified", artifact: artifactJson() }],
              error: null,
            });
          },
        }),
      } as never,
      storage as never,
      {} as never,
    );

    await expect(
      adapter.processor.reverify({
        organizationId,
        productId,
        artifactId,
        actorId,
        expectedVersion: 3,
        sha256: hash,
        byteSize: 1024,
        contentType: "application/octet-stream",
        objectKey: `${organizationId}/${hash}`,
      }),
    ).resolves.toEqual({ outcome: "reverified" });

    expect(calls[0]).toMatchObject({
      name: "reverify_security_update_artifact_worker_atomic",
      args: { p_verified_outcome: "missing" },
    });
  });

  it("deletes the shared-free private object and completes cleanup once scheduling succeeds", async () => {
    const calls: Array<
      Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>
    > = [];
    const storage = { remove: jest.fn().mockResolvedValue(undefined) };
    const objectKey = `${organizationId}/${hash}`;
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: (name: string, args: Readonly<Record<string, unknown>>) => {
            calls.push(Object.freeze({ name, args }));
            if (
              name === "schedule_security_update_artifact_cleanup_worker_atomic"
            ) {
              return Promise.resolve({
                data: [{ outcome: "scheduled", artifact: artifactJson() }],
                error: null,
              });
            }
            if (
              name === "begin_security_update_artifact_cleanup_worker_atomic"
            ) {
              return Promise.resolve({
                data: [{ outcome: "clear", object_key: objectKey }],
                error: null,
              });
            }
            return Promise.resolve({
              data: [{ outcome: "completed", artifact: artifactJson() }],
              error: null,
            });
          },
        }),
      } as never,
      storage as never,
      {} as never,
    );

    await expect(
      adapter.processor.cleanup({
        organizationId,
        productId,
        artifactId,
        actorId,
      }),
    ).resolves.toEqual({ outcome: "cleaned" });

    expect(storage.remove).toHaveBeenCalledWith(objectKey);
    expect(calls.map((call) => call.name)).toEqual([
      "schedule_security_update_artifact_cleanup_worker_atomic",
      "begin_security_update_artifact_cleanup_worker_atomic",
      "complete_security_update_artifact_cleanup_worker_atomic",
    ]);
    expect(calls[2]).toMatchObject({ args: { p_object_removed: true } });
  });

  it.each([
    "shared_object",
    "legal_hold",
    "not_due",
    "already_completed",
  ] as const)(
    "defers cleanup without deleting storage or erroring when begin returns %s",
    async (outcome) => {
      const calls: string[] = [];
      const storage = { remove: jest.fn() };
      const adapter = new SupabaseProductComplianceWorkerAdapter(
        {
          admin: () => ({
            rpc: (name: string) => {
              calls.push(name);
              if (
                name ===
                "schedule_security_update_artifact_cleanup_worker_atomic"
              ) {
                return Promise.resolve({
                  data: [{ outcome: "scheduled", artifact: artifactJson() }],
                  error: null,
                });
              }
              return Promise.resolve({
                data: [{ outcome, object_key: null }],
                error: null,
              });
            },
          }),
        } as never,
        storage as never,
        {} as never,
      );

      await expect(
        adapter.processor.cleanup({
          organizationId,
          productId,
          artifactId,
          actorId,
        }),
      ).resolves.toEqual({ outcome: "cleaned" });

      expect(storage.remove).not.toHaveBeenCalled();
      expect(calls).toEqual([
        "schedule_security_update_artifact_cleanup_worker_atomic",
        "begin_security_update_artifact_cleanup_worker_atomic",
      ]);
    },
  );

  it("rejects a malformed metrics snapshot row as a provider failure", async () => {
    const adapter = new SupabaseProductComplianceWorkerAdapter(
      {
        admin: () => ({
          rpc: () =>
            Promise.resolve({
              data: [{ assessment_backlog: "two" }],
              error: null,
            }),
        }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(adapter.snapshotMetrics(organizationId)).rejects.toMatchObject(
      {
        code: "malformed_provider",
        retryable: false,
      },
    );
  });
});

function artifactJson(overrides: Record<string, unknown> = {}) {
  return {
    id: artifactId,
    organizationId,
    productId,
    releaseId,
    updateVersion: "1.2.3",
    title: "Security update 1.2.3",
    artifactType: "software_update",
    supportedPlatform: "CRA test platform",
    signatureMetadata: null,
    fileName: "security-update.bin",
    contentType: "application/octet-stream",
    byteSize: 1024,
    sha256: hash,
    uploadStatus: "reserved",
    integrityStatus: "pending",
    reviewStatus: "pending_review",
    publicationStatus: "draft",
    availabilityStatus: "pending",
    statusExplanation: null,
    issuedAt: "2026-08-17T12:00:00.000Z",
    supportPeriodId: null,
    supportPeriodRevision: null,
    supportEndsAt: null,
    availabilityRuleVersion: "m2.v2.security-update-availability.v1",
    issuedCandidate: null,
    supportCandidate: null,
    availabilityWinningRule: null,
    computedAvailabilityUntil: null,
    availabilityUntil: null,
    nonReductionApplied: false,
    distributionKind: "authenticated_download",
    distributionReference: null,
    publishedExternalReferences: [],
    replacementArtifactId: null,
    withdrawnAt: null,
    withdrawnReason: null,
    version: 3,
    createdAt: "2026-08-17T12:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-08-17T12:00:00.000Z",
    updatedBy: actorId,
    ...overrides,
  };
}

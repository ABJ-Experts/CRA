import { describe, expect, it } from "vitest";

import {
  operatorInstancesQuerySchema,
  operatorInstancesResponseSchema,
} from "./operator-registry.schema.js";

describe("operator registry schemas", () => {
  it("accepts scoped instance metadata without tenant content", () => {
    expect(
      operatorInstancesResponseSchema.parse({
        schemaVersion: 1,
        observedAt: "2026-10-14T10:00:00.000Z",
        instances: [
          {
            instanceId: "22222222-2222-4222-8222-222222222222",
            label: "Local CRA",
            status: "healthy",
            version: "1.2.3",
            commit: "4b5f677",
            lastObservedAt: "2026-10-14T10:00:00.000Z",
            licenceSummary: {
              active: 1,
              grace: 0,
              expiredReadOnly: 0,
              invalid: 0,
              missing: 0,
              unknown: 0,
            },
            tenantCount: 1,
            sources: [
              {
                source: "local",
                sourceAt: "2026-10-14T10:00:00.000Z",
                observedAt: "2026-10-14T10:00:00.000Z",
                status: "healthy",
                attemptedAt: "2026-10-14T10:00:00.000Z",
                succeededAt: "2026-10-14T10:00:00.000Z",
                receivedAt: "2026-10-14T10:00:00.000Z",
                reasons: [],
              },
            ],
          },
        ],
        nextCursor: null,
      }),
    ).toMatchObject({ nextCursor: null });
  });

  it("rejects arbitrary private metadata fields", () => {
    const result = operatorInstancesResponseSchema.safeParse({
      schemaVersion: 1,
      observedAt: "2026-10-14T10:00:00.000Z",
      instances: [
        {
          instanceId: "22222222-2222-4222-8222-222222222222",
          label: "Local CRA",
          status: "healthy",
          version: "1.2.3",
          commit: "4b5f677",
          lastObservedAt: "2026-10-14T10:00:00.000Z",
          internalHostname: "api.private.local",
          tenantCount: 1,
          licenceSummary: {
            active: 1,
            grace: 0,
            expiredReadOnly: 0,
            invalid: 0,
            missing: 0,
            unknown: 0,
          },
          sources: [],
        },
      ],
      nextCursor: null,
    });

    expect(result.success).toBe(false);
  });

  it("bounds pagination inputs", () => {
    expect(operatorInstancesQuerySchema.parse({ limit: "100" }).limit).toBe(
      100,
    );
    expect(
      operatorInstancesQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(
      operatorInstancesQuerySchema.safeParse({ cursor: "../secret" }).success,
    ).toBe(false);
  });
});

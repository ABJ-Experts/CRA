import { SupabaseProductClassificationRepository } from "./supabase-product-classification";
import { PRODUCT_CLASSIFICATION_POLICY } from "@repo/contracts/products";
import type { SupabaseService } from "../../supabase/supabase.service";
import { ClassificationFailure } from "../application/product-classification";
const input = {
  expectedProductVersion: 1,
  expectedRevision: 0,
  policyVersion: PRODUCT_CLASSIFICATION_POLICY.version,
  policyHash: PRODUCT_CLASSIFICATION_POLICY.hash,
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  rationale: "Scope exclusion",
  answers: {
    scope: "out_of_scope" as const,
    criticalCoreFunction: null,
    classIICoreFunction: null,
    classICoreFunction: null,
  },
};
describe("classification Supabase boundary", () => {
  it.each([
    "not_found",
    "forbidden",
    "conflict",
    "invalid_request",
    "invalid_state",
    "idempotency_mismatch",
  ])("preserves atomic %s outcome", async (outcome) => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ outcome, run: null }], error: null });
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    await expect(
      adapter.save(
        "org",
        "actor",
        "product",
        input,
        PRODUCT_CLASSIFICATION_POLICY,
      ),
    ).rejects.toEqual(new ClassificationFailure(outcome as "conflict"));
    expect((rpc.mock.calls as unknown[][])[0]?.[1]).toMatchObject({
      p_organization_id: "org",
      p_actor_user_id: "actor",
      p_product_id: "product",
      p_expected_revision: 0,
      p_policy_hash: input.policyHash,
      p_idempotency_key: input.idempotencyKey,
    });
  });
  it.each([
    { data: null, error: { message: "private" } },
    { data: [{ outcome: "unknown" }], error: null },
    { data: [{ outcome: "saved", run: {} }], error: null },
  ])("conceals malformed/outage provider", async (result) => {
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({ rpc: jest.fn().mockResolvedValue(result) }),
    } as unknown as SupabaseService);
    await expect(
      adapter.save(
        "org",
        "actor",
        "product",
        input,
        PRODUCT_CLASSIFICATION_POLICY,
      ),
    ).rejects.toBeInstanceOf(ClassificationFailure);
  });
});
const id = "11111111-1111-4111-8111-111111111111";
const wireRun = {
  id,
  productId: id,
  revision: 1,
  productVersion: 1,
  classification: "out_of_scope",
  answers: input.answers,
  rationale: input.rationale,
  policySnapshot: PRODUCT_CLASSIFICATION_POLICY,
  policyHash: input.policyHash,
  createdBy: id,
  createdAt: "2026-09-28T00:00:00Z",
  supersedesId: null,
};
describe("classification scoped reads and successful commands", () => {
  it.each(["saved", "replayed"])(
    "parses immutable %s result",
    async (outcome) => {
      const rpc = jest
        .fn()
        .mockResolvedValue({ data: [{ outcome, run: wireRun }], error: null });
      const adapter = new SupabaseProductClassificationRepository({
        admin: () => ({ rpc }),
      } as unknown as SupabaseService);
      expect(
        await adapter.save(
          "org",
          "actor",
          id,
          input,
          PRODUCT_CLASSIFICATION_POLICY,
        ),
      ).toMatchObject({
        run: {
          id,
          classification: "out_of_scope",
          policySnapshot: { status: "engineering_provisional" },
        },
      });
    },
  );
  it("rejects invalid provider run primitive", async () => {
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [{ outcome: "saved", run: 3 }],
          error: null,
        }),
      }),
    } as unknown as SupabaseService);
    await expect(
      adapter.save("org", "actor", id, input, PRODUCT_CLASSIFICATION_POLICY),
    ).rejects.toEqual(new ClassificationFailure("malformed_provider"));
  });
  it("rechecks the verified actor in one scoped history RPC and preserves native pagination", async () => {
    const history = {
      productVersion: 1,
      latest: wireRun,
      runs: { rows: [wireRun], page: 2, pageSize: 1, total: 3, pageCount: 3 },
    };
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "found", history }],
      error: null,
    });
    const from = jest.fn();
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({ rpc, from }),
    } as unknown as SupabaseService);
    expect(
      await adapter.history("org", "verified-actor", id, {
        page: 2,
        pageSize: 1,
      }),
    ).toEqual(history);
    expect(rpc).toHaveBeenCalledWith("get_product_classification_history", {
      p_organization_id: "org",
      p_actor_user_id: "verified-actor",
      p_product_id: id,
      p_page: 2,
      p_page_size: 1,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("preserves empty native history", async () => {
    const history = {
      productVersion: 1,
      latest: null,
      runs: { rows: [], page: 1, pageSize: 15, total: 0, pageCount: 1 },
    };
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [{ outcome: "found", history }],
          error: null,
        }),
      }),
    } as unknown as SupabaseService);
    expect(
      await adapter.history("org", "actor", id, { page: 1, pageSize: 15 }),
    ).toEqual(history);
  });
  it.each(["forbidden", "not_found", "invalid_request"] as const)(
    "honors history %s including revoked permission",
    async (outcome) => {
      const adapter = new SupabaseProductClassificationRepository({
        admin: () => ({
          rpc: jest.fn().mockResolvedValue({
            data: [{ outcome, history: null }],
            error: null,
          }),
        }),
      } as unknown as SupabaseService);
      await expect(
        adapter.history("org", "actor", id, { page: 1, pageSize: 15 }),
      ).rejects.toEqual(new ClassificationFailure(outcome));
    },
  );
  it.each([
    { data: [], error: null },
    { data: [{ outcome: "other", history: null }], error: null },
    { data: [{ outcome: "found", history: {} }], error: null },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: null,
            runs: {
              rows: [wireRun],
              page: 1,
              pageSize: 15,
              total: 0,
              pageCount: 1,
            },
          },
        },
      ],
      error: null,
    },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: wireRun,
            runs: {
              rows: [wireRun],
              page: 2,
              pageSize: 15,
              total: 1,
              pageCount: 1,
            },
          },
        },
      ],
      error: null,
    },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: wireRun,
            runs: {
              rows: [wireRun],
              page: 1,
              pageSize: 100,
              total: 1,
              pageCount: 1,
            },
          },
        },
      ],
      error: null,
    },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: {
              ...wireRun,
              productId: "22222222-2222-4222-8222-222222222222",
            },
            runs: { rows: [], page: 1, pageSize: 15, total: 1, pageCount: 1 },
          },
        },
      ],
      error: null,
    },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: wireRun,
            runs: {
              rows: [
                {
                  ...wireRun,
                  productId: "22222222-2222-4222-8222-222222222222",
                },
              ],
              page: 1,
              pageSize: 15,
              total: 1,
              pageCount: 1,
            },
          },
        },
      ],
      error: null,
    },
    {
      data: [
        {
          outcome: "found",
          history: {
            productVersion: 1,
            latest: wireRun,
            runs: {
              rows: [{ ...wireRun, classification: "critical" }],
              page: 1,
              pageSize: 15,
              total: 1,
              pageCount: 1,
            },
          },
        },
      ],
      error: null,
    },
  ])(
    "rejects malformed history, substituted products, pagination, and derived results",
    async (result) => {
      const adapter = new SupabaseProductClassificationRepository({
        admin: () => ({ rpc: jest.fn().mockResolvedValue(result) }),
      } as unknown as SupabaseService);
      await expect(
        adapter.history("org", "actor", id, { page: 1, pageSize: 15 }),
      ).rejects.toEqual(new ClassificationFailure("malformed_provider"));
    },
  );
  it("conceals a history provider outage", async () => {
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({
        rpc: jest
          .fn()
          .mockResolvedValue({ data: null, error: { message: "private" } }),
      }),
    } as unknown as SupabaseService);
    await expect(
      adapter.history("org", "actor", id, { page: 1, pageSize: 15 }),
    ).rejects.toEqual(new ClassificationFailure("unavailable"));
  });
  it("uses one bounded atomic latest RPC and returns minimal summaries", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          classifications: [{ productId: id, latest: null }],
        },
      ],
      error: null,
    });
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    expect(await adapter.latest("org", "actor", { productIds: [id] })).toEqual({
      classifications: [{ productId: id, latest: null }],
    });
    expect(rpc).toHaveBeenCalledWith("get_product_classifications_latest", {
      p_organization_id: "org",
      p_actor_user_id: "actor",
      p_product_ids: [id],
    });
  });
  it.each([
    [{ data: [], error: null }, "malformed_provider"],
    [
      { data: [{ outcome: "not_found", classifications: null }], error: null },
      "not_found",
    ],
    [
      { data: [{ outcome: "forbidden", classifications: null }], error: null },
      "forbidden",
    ],
    [
      {
        data: [{ outcome: "invalid_request", classifications: null }],
        error: null,
      },
      "invalid_request",
    ],
    [
      { data: [{ outcome: "other", classifications: null }], error: null },
      "malformed_provider",
    ],
    [
      { data: [{ outcome: "found", classifications: [] }], error: null },
      "malformed_provider",
    ],
    [
      {
        data: [
          {
            outcome: "found",
            classifications: [
              {
                productId: "22222222-2222-4222-8222-222222222222",
                latest: null,
              },
            ],
          },
        ],
        error: null,
      },
      "malformed_provider",
    ],
    [
      { data: [{ outcome: "found", classifications: "bad" }], error: null },
      "malformed_provider",
    ],
  ] as const)(
    "rejects malformed or unauthorized bulk read",
    async (result, code) => {
      const adapter = new SupabaseProductClassificationRepository({
        admin: () => ({ rpc: jest.fn().mockResolvedValue(result) }),
      } as unknown as SupabaseService);
      await expect(
        adapter.latest("org", "actor", { productIds: [id] }),
      ).rejects.toEqual(new ClassificationFailure(code));
    },
  );
});

describe("classification result integrity", () => {
  it("rejects a provider classification inconsistent with its immutable answers", async () => {
    const adapter = new SupabaseProductClassificationRepository({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [
            {
              outcome: "saved",
              run: { ...wireRun, classification: "critical" },
            },
          ],
          error: null,
        }),
      }),
    } as unknown as SupabaseService);
    await expect(
      adapter.save("org", "actor", id, input, PRODUCT_CLASSIFICATION_POLICY),
    ).rejects.toEqual(new ClassificationFailure("malformed_provider"));
  });
});

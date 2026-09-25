import { SupabaseFrameworkRepository } from "./supabase-framework.repository";
import {
  FrameworkConflictError,
  FrameworkForbiddenError,
  FrameworkInvalidRequestError,
  FrameworkUpgradeRequiredError,
  FrameworkPackBlockedError,
} from "../application/framework-use-cases";
import type { SupabaseService } from "../../supabase/supabase.service";
import { ServiceUnavailableException } from "@nestjs/common";

describe("SupabaseFrameworkRepository", () => {
  const rpc = jest.fn();
  const from = jest.fn();
  const supabase = {
    admin: () => ({ rpc, from }),
  } as unknown as SupabaseService;
  const repository = new SupabaseFrameworkRepository(supabase);

  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  const selectionInput = {
    actorId: "user-a",
    packKey: "cra",
    versionKey: "2024",
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
  };

  function memberQuery(
    data: unknown = { user_id: "user-a" },
    error: unknown = null,
  ) {
    const query = {
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    };
    query.eq.mockReturnValue(query);
    return query;
  }

  function packQuery(
    data: unknown = {
      pack_key: "cra",
      edition_date: "2024-11-20",
      language: "en",
    },
    error: unknown = null,
  ) {
    const query = {
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    };
    query.eq.mockReturnValue(query);
    return query;
  }

  function pageQuery(data: unknown, error: unknown = null) {
    const query = {
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({ data, error }),
    };
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    return query;
  }

  it("scopes selection RPC to the verified organization and actor", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "selected",
          result: {
            packKey: "cra",
            versionKey: "2024",
            enabled: true,
            revision: 1,
          },
        },
      ],
      error: null,
    });
    const input = {
      actorId: "user-a",
      packKey: "cra",
      versionKey: "2024",
      enabled: true,
      expectedRevision: null,
      idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
    };
    await expect(repository.select("org-a", input)).resolves.toEqual({
      packKey: "cra",
      versionKey: "2024",
      enabled: true,
      revision: 1,
    });
    expect(rpc).toHaveBeenCalledWith("m10_select_framework_version", {
      p_organization_id: "org-a",
      p_actor_user_id: "user-a",
      p_pack_key: "cra",
      p_version_key: "2024",
      p_enabled: true,
      p_expected_revision: null,
      p_idempotency_key: input.idempotencyKey,
    });
  });

  it.each([
    ["conflict", FrameworkConflictError],
    ["upgrade_required", FrameworkUpgradeRequiredError],
    ["blocked", FrameworkPackBlockedError],
    ["forbidden", FrameworkForbiddenError],
  ])(
    "maps %s without leaking database details",
    async (outcome, errorClass) => {
      rpc.mockResolvedValue({ data: [{ outcome, result: {} }], error: null });
      await expect(
        repository.select("org-a", {
          actorId: "user-a",
          packKey: "cra",
          versionKey: "2024",
          enabled: true,
          expectedRevision: 1,
          idempotencyKey: "2f564a90-a9ef-46e9-afd8-b743866860ff",
        }),
      ).rejects.toBeInstanceOf(errorClass);
    },
  );

  it("filters catalog selection by organization", async () => {
    const member = {
      eq: jest.fn(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { user_id: "user-a" }, error: null }),
    };
    member.eq.mockReturnValue(member);
    const packRows = [
      {
        pack_key: "cra",
        version_key: "2024",
        title: "CRA",
        edition_date: "2024-11-20",
        language: "en",
        source_celex: "32024R2847",
        source_url: "https://eur-lex.europa.eu/",
        attribution: "Official Journal",
        content_hash: "a".repeat(64),
      },
      {
        pack_key: "iec-62443-4-1",
        version_key: "ed2",
        title: "IEC 62443-4-1",
        edition_date: "2025-01-01",
        language: "en",
        source_celex: null,
        source_url: "https://example.org/authorized-edition",
        attribution: "Licensed standard",
        content_hash: "b".repeat(64),
        source_kind: "licensed_standard",
        edition_label: "Edition 2",
        distribution_rights: "Internal authorized distribution only",
        review_owner: "Standards reviewer",
      },
    ];
    const packQuery = {
      order: jest.fn(),
      limit: jest.fn().mockResolvedValue({ data: packRows, error: null }),
    };
    packQuery.order.mockReturnValue(packQuery);
    const selectionQuery = {
      eq: jest.fn(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    selectionQuery.eq.mockReturnValue(selectionQuery);
    from
      .mockReturnValueOnce({ select: () => member })
      .mockReturnValueOnce({ select: () => packQuery })
      .mockReturnValueOnce({ select: () => selectionQuery });
    await expect(repository.catalog("org-a", "user-a")).resolves.toEqual({
      packs: [
        {
          packKey: "cra",
          title: "CRA",
          versions: [
            {
              versionKey: "2024",
              editionDate: "2024-11-20",
              language: "en",
              sourceUrl: "https://eur-lex.europa.eu/",
              sourceReference: "CELEX:32024R2847",
              attribution: "Official Journal",
              contentHash: "a".repeat(64),
            },
          ],
          selection: null,
        },
        {
          packKey: "iec-62443-4-1",
          title: "IEC 62443-4-1",
          versions: [
            {
              versionKey: "ed2",
              editionDate: "2025-01-01",
              language: "en",
              sourceUrl: "https://example.org/authorized-edition",
              sourceReference: "Edition 2",
              attribution: "Licensed standard",
              contentHash: "b".repeat(64),
              sourceKind: "licensed_standard",
              editionLabel: "Edition 2",
              distributionRights: "Internal authorized distribution only",
              reviewOwner: "Standards reviewer",
            },
          ],
          selection: null,
        },
      ],
    });
    expect(selectionQuery.eq).toHaveBeenCalledWith("organization_id", "org-a");
  });

  it("checks scoped membership before reading an immutable version", async () => {
    const member = {
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    member.eq.mockReturnValue(member);
    from.mockReturnValueOnce({ select: () => member });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(FrameworkForbiddenError);
    expect(member.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(member.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded tree page and opaque next cursor", async () => {
    const member = {
      eq: jest.fn(),
      maybeSingle: jest
        .fn()
        .mockResolvedValue({ data: { user_id: "user-a" }, error: null }),
    };
    member.eq.mockReturnValue(member);
    const pack = {
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { pack_key: "cra", edition_date: "2024-11-20", language: "en" },
        error: null,
      }),
    };
    pack.eq.mockReturnValue(pack);
    const page = {
      eq: jest.fn(),
      order: jest.fn(),
      range: jest.fn().mockResolvedValue({
        data: [
          {
            requirement_key: "i-1",
            identifier: "Part I 1",
            parent_requirement_key: null,
            position: 1,
            depth: 0,
            heading: null,
            text: "Exact text.",
            source_reference: "Annex I Part I 1",
          },
          {
            requirement_key: "i-2",
            identifier: "Part I 2",
            parent_requirement_key: null,
            position: 2,
            depth: 0,
            heading: null,
            text: "Next text.",
            source_reference: "Annex I Part I 2",
          },
        ],
        error: null,
      }),
    };
    page.eq.mockReturnValue(page);
    page.order.mockReturnValue(page);
    from
      .mockReturnValueOnce({ select: () => member })
      .mockReturnValueOnce({ select: () => pack })
      .mockReturnValueOnce({ select: () => page });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 1,
      }),
    ).resolves.toEqual({
      packKey: "cra",
      versionKey: "2024",
      editionDate: "2024-11-20",
      language: "en",
      requirements: [
        {
          requirementKey: "i-1",
          identifier: "Part I 1",
          parentKey: null,
          position: 1,
          depth: 0,
          heading: null,
          text: "Exact text.",
          sourceReference: "Annex I Part I 1",
        },
      ],
      nextCursor: "MQ",
    });
    expect(page.range).toHaveBeenCalledWith(0, 1);
    expect(page.order).toHaveBeenCalledWith("tree_order");
  });

  it("returns null for an unknown pack version after membership verification", async () => {
    from
      .mockReturnValueOnce({ select: () => memberQuery() })
      .mockReturnValueOnce({ select: () => packQuery(null) });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "missing",
        limit: 10,
      }),
    ).resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(2);
  });

  it.each(["!", "MDAw", "MTAwMQ"])(
    "rejects malformed or oversized cursor %s",
    async (cursor) => {
      from
        .mockReturnValueOnce({ select: () => memberQuery() })
        .mockReturnValueOnce({ select: () => packQuery() });
      await expect(
        repository.tree("org-a", {
          actorId: "user-a",
          packKey: "cra",
          versionKey: "2024",
          limit: 10,
          cursor,
        }),
      ).rejects.toBeInstanceOf(FrameworkInvalidRequestError);
      expect(from).toHaveBeenCalledTimes(2);
    },
  );

  it("decodes a valid cursor and returns the final page without another cursor", async () => {
    const page = pageQuery([
      {
        requirement_key: "i-2",
        identifier: "Part I 2",
        parent_requirement_key: null,
        position: 2,
        depth: 0,
        heading: null,
        text: "Next text.",
        source_reference: "Annex I Part I 2",
      },
    ]);
    from
      .mockReturnValueOnce({ select: () => memberQuery() })
      .mockReturnValueOnce({ select: () => packQuery() })
      .mockReturnValueOnce({ select: () => page });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 10,
        cursor: "MQ",
      }),
    ).resolves.toMatchObject({
      nextCursor: null,
      requirements: [{ requirementKey: "i-2" }],
    });
    expect(page.range).toHaveBeenCalledWith(1, 11);
  });

  it("fails closed on membership, pack and page read errors", async () => {
    from.mockReturnValueOnce({
      select: () => memberQuery(null, { message: "offline" }),
    });
    await expect(repository.catalog("org-a", "user-a")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    from
      .mockReturnValueOnce({ select: () => memberQuery() })
      .mockReturnValueOnce({
        select: () => packQuery(null, { message: "offline" }),
      });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    from
      .mockReturnValueOnce({ select: () => memberQuery() })
      .mockReturnValueOnce({ select: () => packQuery() })
      .mockReturnValueOnce({
        select: () => pageQuery(null, { message: "offline" }),
      });
    await expect(
      repository.tree("org-a", {
        actorId: "user-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each(["invalid_request", "unknown", "unchanged"])(
    "maps RPC outcome %s safely",
    async (outcome) => {
      rpc.mockResolvedValue({
        data: [
          {
            outcome,
            result: {
              packKey: "cra",
              versionKey: "2024",
              enabled: true,
              revision: 2,
            },
          },
        ],
        error: null,
      });
      const promise = repository.select("org-a", selectionInput);
      if (outcome === "invalid_request")
        await expect(promise).rejects.toBeInstanceOf(
          FrameworkInvalidRequestError,
        );
      else if (outcome === "unknown")
        await expect(promise).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      else await expect(promise).resolves.toMatchObject({ revision: 2 });
    },
  );

  it("fails closed for an unavailable or malformed selection RPC", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "secret detail" },
      })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(
      repository.select("org-a", selectionInput),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      repository.select("org-a", selectionInput),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

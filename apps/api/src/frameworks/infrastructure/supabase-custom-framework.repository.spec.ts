import { ServiceUnavailableException } from "@nestjs/common";

import type { SupabaseService } from "../../supabase/supabase.service";
import {
  CustomFrameworkBlockedError,
  CustomFrameworkConflictError,
  CustomFrameworkForbiddenError,
  CustomFrameworkInvalidError,
  CustomFrameworkNotFoundError,
} from "../application/custom-framework-use-cases";
import { SupabaseCustomFrameworkRepository } from "./supabase-custom-framework.repository";

const draftId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "22222222-2222-4222-8222-222222222222";
const packKey = `custom.${draftId}`;

const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal policy",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
};

const summary = {
  draftId,
  packKey,
  title: content.title,
  status: "draft",
  revision: 1,
  latestVersionKey: null,
  selectedVersionKey: null,
  contentHash: null,
  archivedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

function singleQuery(data: unknown, error: unknown = null) {
  const query = {
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data, error }),
  };
  query.eq.mockReturnValue(query);
  return query;
}

function listQuery(data: unknown, error: unknown = null) {
  const query = {
    eq: jest.fn(),
    order: jest.fn().mockResolvedValue({ data, error }),
    limit: jest.fn().mockResolvedValue({ data, error }),
  };
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  return query;
}

describe("SupabaseCustomFrameworkRepository", () => {
  const rpc = jest.fn();
  const from = jest.fn();
  const repository = new SupabaseCustomFrameworkRepository({
    admin: () => ({ rpc, from }),
  } as unknown as SupabaseService);

  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("passes verified scope and paging to the list RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        { outcome: "listed", result: { items: [summary], nextOffset: null } },
      ],
      error: null,
    });

    await expect(repository.list("org-a", "actor-a", 20, 0)).resolves.toEqual({
      items: [summary],
      nextOffset: null,
    });
    expect(rpc).toHaveBeenCalledWith("m10_custom_pack_page", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_limit: 20,
      p_offset: 0,
    });
  });

  it("accepts single-object RPC envelopes and rejects malformed envelopes", async () => {
    rpc.mockResolvedValueOnce({
      data: { outcome: "listed", result: { items: [], nextOffset: null } },
      error: null,
    });
    await expect(repository.list("org-a", "actor-a", 20, 0)).resolves.toEqual({
      items: [],
      nextOffset: null,
    });

    rpc.mockResolvedValueOnce({
      data: { outcome: 42, result: null },
      error: null,
    });
    await expect(
      repository.list("org-a", "actor-a", 20, 0),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("passes verified scope and draft id to the detail RPC", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { ...summary, content } }],
      error: null,
    });

    await expect(
      repository.detail("org-a", "actor-a", draftId),
    ).resolves.toEqual({ ...summary, content });
    expect(rpc).toHaveBeenCalledWith("m10_custom_pack_detail", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_draft_id: draftId,
    });
  });

  it("passes create payload without caller-controlled draft id", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "created", result: summary }],
      error: null,
    });

    await expect(
      repository.command("org-a", "actor-a", null, {
        action: "create_draft",
        content,
        idempotencyKey,
      }),
    ).resolves.toEqual(summary);
    expect(rpc).toHaveBeenCalledWith("m10_custom_pack_command", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_operation: "create_draft",
      p_payload: { document: content },
      p_expected_revision: null,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("passes revisioned commands with scoped draft id", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "published",
          result: { ...summary, latestVersionKey: "v1" },
        },
      ],
      error: null,
    });

    await expect(
      repository.command("org-a", "actor-a", draftId, {
        action: "publish_version",
        expectedRevision: 1,
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ latestVersionKey: "v1" });
    expect(rpc).toHaveBeenCalledWith("m10_custom_pack_command", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_operation: "publish_version",
      p_payload: { draftId },
      p_expected_revision: 1,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("passes save commands with content and scoped draft id", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "saved", result: { ...summary, revision: 2 } }],
      error: null,
    });

    await expect(
      repository.command("org-a", "actor-a", draftId, {
        action: "save_draft",
        content,
        expectedRevision: 1,
        idempotencyKey,
      }),
    ).resolves.toMatchObject({ revision: 2 });
    expect(rpc).toHaveBeenCalledWith(
      "m10_custom_pack_command",
      expect.objectContaining({
        p_payload: { draftId, document: content },
        p_expected_revision: 1,
      }),
    );
  });

  it.each(["archived", "restored", "unchanged"] as const)(
    "accepts %s command outcomes",
    async (outcome) => {
      rpc.mockResolvedValue({
        data: [{ outcome, result: summary }],
        error: null,
      });
      await expect(
        repository.command("org-a", "actor-a", draftId, {
          action: "restore_draft",
          expectedRevision: 1,
          idempotencyKey,
        }),
      ).resolves.toEqual(summary);
    },
  );

  it.each([
    ["forbidden", CustomFrameworkForbiddenError],
    ["not_found", CustomFrameworkNotFoundError],
    ["invalid_request", CustomFrameworkInvalidError],
    ["conflict", CustomFrameworkConflictError],
    ["blocked", CustomFrameworkBlockedError],
  ])("maps %s without leaking provider details", async (outcome, expected) => {
    rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
    await expect(
      repository.command("org-a", "actor-a", draftId, {
        action: "archive_draft",
        expectedRevision: 1,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(expected);
  });

  it("hides provider failures and malformed rows behind service unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "detail" } });
    await expect(
      repository.list("org-a", "actor-a", 20, 0),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "listed", result: {} }],
      error: null,
    });
    await expect(
      repository.list("org-a", "actor-a", 20, 0),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "created", result: summary }],
      error: null,
    });
    await expect(
      repository.list("org-a", "actor-a", 20, 0),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "listed", result: null }],
      error: null,
    });
    await expect(
      repository.detail("org-a", "actor-a", draftId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("rejects unknown successful command outcomes as provider failure", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "surprising", result: summary }],
      error: null,
    });

    await expect(
      repository.command("org-a", "actor-a", draftId, {
        action: "restore_draft",
        expectedRevision: 1,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("exports an immutable published version scoped to the owner organization", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { ...summary, content } }],
      error: null,
    });
    const versionQuery = singleQuery({
      title: "Published controls",
      edition_date: "2026-09-25",
      language: "en",
      attribution: "Internal policy",
      source_url: null,
    });
    const requirementsQuery = listQuery([
      {
        requirement_key: "control-1",
        identifier: "INT-1",
        parent_requirement_key: null,
        position: 1,
        heading: "Design review",
        text: "Document design control decisions.",
        source_reference: "Policy 1",
      },
    ]);
    from
      .mockReturnValueOnce({ select: () => versionQuery })
      .mockReturnValueOnce({ select: () => requirementsQuery });

    await expect(
      repository.exportVersion("org-a", "actor-a", draftId, "v1"),
    ).resolves.toEqual({
      title: "Published controls",
      editionDate: "2026-09-25",
      language: "en",
      attribution: "Internal policy",
      requirements: content.requirements,
    });
    expect(versionQuery.eq).toHaveBeenCalledWith("owner_org_id", "org-a");
    expect(versionQuery.eq).toHaveBeenCalledWith("pack_key", packKey);
    expect(versionQuery.eq).toHaveBeenCalledWith("version_key", "v1");
    expect(requirementsQuery.eq).toHaveBeenCalledWith("owner_org_id", "org-a");
    expect(requirementsQuery.eq).toHaveBeenCalledWith("pack_key", packKey);
    expect(requirementsQuery.eq).toHaveBeenCalledWith("version_key", "v1");
  });

  it("preserves source URL when exporting a published version", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { ...summary, content } }],
      error: null,
    });
    from
      .mockReturnValueOnce({
        select: () =>
          singleQuery({
            title: "Published controls",
            edition_date: "2026-09-25",
            language: "en",
            attribution: "Internal policy",
            source_url: "https://example.com/policy",
          }),
      })
      .mockReturnValueOnce({
        select: () =>
          listQuery(
            content.requirements.map((item) => ({
              requirement_key: item.requirementKey,
              identifier: item.identifier,
              parent_requirement_key: item.parentKey,
              position: item.position,
              heading: item.heading,
              text: item.text,
              source_reference: item.sourceReference,
            })),
          ),
      });

    await expect(
      repository.exportVersion("org-a", "actor-a", draftId, "v1"),
    ).resolves.toMatchObject({ sourceUrl: "https://example.com/policy" });
  });

  it("does not reveal a missing or malformed published export", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { ...summary, content } }],
      error: null,
    });
    from.mockReturnValueOnce({ select: () => singleQuery(null) });
    await expect(
      repository.exportVersion("org-a", "actor-a", draftId, "v1"),
    ).rejects.toBeInstanceOf(CustomFrameworkNotFoundError);

    from.mockReset();
    from.mockReturnValueOnce({
      select: () => singleQuery(null, { message: "provider detail" }),
    });
    await expect(
      repository.exportVersion("org-a", "actor-a", draftId, "v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    from.mockReset();
    from
      .mockReturnValueOnce({
        select: () =>
          singleQuery({
            title: "Published controls",
            edition_date: "2026-09-25",
            language: "en",
            attribution: "Internal policy",
            source_url: null,
          }),
      })
      .mockReturnValueOnce({ select: () => listQuery(null) });
    await expect(
      repository.exportVersion("org-a", "actor-a", draftId, "v1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("runs a scoped SQL dry run and treats provider rejection as invalid", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "validated", result: { valid: true } }],
      error: null,
    });
    await expect(
      repository.validate("org-a", "actor-a", content),
    ).resolves.toEqual({ valid: true, errors: [] });
    expect(rpc).toHaveBeenCalledWith("m10_custom_pack_validate", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_document: content,
    });

    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "invalid_request",
          result: {
            valid: false,
            errors: [
              { path: "content.title", message: "Title contains markup" },
            ],
          },
        },
      ],
      error: null,
    });
    await expect(
      repository.validate("org-a", "actor-a", content),
    ).resolves.toEqual({
      valid: false,
      errors: [{ path: "content.title", message: "Title contains markup" }],
    });

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "forbidden", result: null }],
      error: null,
    });
    await expect(
      repository.validate("org-a", "actor-a", content),
    ).rejects.toBeInstanceOf(CustomFrameworkForbiddenError);
  });
});

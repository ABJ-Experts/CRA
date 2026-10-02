import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { RequestUser } from "../auth/auth.types";
import { SupplierEvidenceSbomNotFoundError } from "./application/supplier-evidence-sbom.use-cases";
import {
  SupplierEvidenceForbiddenError,
  SupplierEvidenceUnavailableError,
} from "./application/supplier-evidence-use-cases";
import {
  SupplierEvidenceSbomInternalController,
  SupplierEvidenceSbomPortalController,
} from "./supplier-evidence-sbom.controller";

const organizationId = "00000000-0000-4000-8000-000000000001";
const user = {
  id: "00000000-0000-4000-8000-000000000002",
  organizationId,
} as RequestUser;

describe("M9 supplier SBOM controllers", () => {
  const sbom = {
    eligible: jest.fn(),
    initialize: jest.fn(),
    complete: jest.fn(),
  };
  const internal = new SupplierEvidenceSbomInternalController(sbom as never);
  const portal = new SupplierEvidenceSbomPortalController(sbom as never);

  beforeEach(() => jest.resetAllMocks());

  it("uses verified organization and actor for eligible internal requests", async () => {
    sbom.eligible.mockResolvedValue({ requests: [], nextCursor: null });
    await internal.eligible(
      {
        supplierId: "00000000-0000-4000-8000-000000000003",
        productId: "00000000-0000-4000-8000-000000000004",
        limit: 25,
      },
      user,
    );
    expect(sbom.eligible).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId: user.id, limit: 25 }),
    );
  });

  it("returns only the portal-safe upload response", async () => {
    sbom.initialize.mockResolvedValue({
      reservation: {
        id: "00000000-0000-4000-8000-000000000005",
        organizationId,
        productId: "secret",
      },
      submission: {
        id: "00000000-0000-4000-8000-000000000006",
        state: "pending",
        fileName: "sbom.json",
        validationMessage: null,
      },
      upload: {
        uploadUrl: "https://local.test/upload",
        expiresAt: "2026-09-25T00:00:00Z",
      },
    });
    const result = await portal.initialize(
      { checklistItemId: "00000000-0000-4000-8000-000000000007" },
      {
        sessionToken: "supplier-evidence-session-token-0123456789",
        fileName: "sbom.json",
        mediaType: "application/json",
        byteSize: 100,
        sha256: "a".repeat(64),
        idempotencyKey: "00000000-0000-4000-8000-000000000008",
      },
    );
    expect(result.sourceId).toBe("00000000-0000-4000-8000-000000000005");
    expect(result.submission.id).toBe("00000000-0000-4000-8000-000000000006");
    expect(result.upload.uploadUrl).toBe("https://local.test/upload");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("requires a verified organization for the internal selector", async () => {
    await expect(
      internal.eligible(
        {
          supplierId: "00000000-0000-4000-8000-000000000003",
          productId: "00000000-0000-4000-8000-000000000004",
          limit: 25,
        },
        { ...user, organizationId: null },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sbom.eligible).not.toHaveBeenCalled();
  });

  it("returns a safe completion state without M3 source or product details", async () => {
    sbom.complete.mockResolvedValue({
      submission: {
        id: "00000000-0000-4000-8000-000000000006",
        state: "validation_failed",
        fileName: "wrong.json",
        validationMessage: "internal product identifier",
        sourceId: "internal-source-id",
        createdAt: "2026-09-23T00:00:00Z",
        updatedAt: "2026-09-23T00:00:01Z",
      },
    });
    const result = await portal.complete(
      {
        checklistItemId: "00000000-0000-4000-8000-000000000007",
        sourceId: "00000000-0000-4000-8000-000000000005",
      },
      {
        sessionToken: "supplier-evidence-session-token-0123456789",
        idempotencyKey: "00000000-0000-4000-8000-000000000008",
      },
    );
    expect(result.submission.state).toBe("validation_failed");
    expect(result.submission.validationMessage).toContain(
      "requested component",
    );
    expect(JSON.stringify(result)).not.toContain("internal product identifier");
    expect(JSON.stringify(result)).not.toContain("internal-source-id");
  });

  it.each([
    [new SupplierEvidenceSbomNotFoundError(), NotFoundException],
    [new SupplierEvidenceForbiddenError(), ForbiddenException],
    [new SupplierEvidenceUnavailableError(), ServiceUnavailableException],
    [new Error("internal supplier data"), ServiceUnavailableException],
  ])("keeps supplier upload errors safe", async (failure, expected) => {
    sbom.initialize.mockRejectedValue(failure);
    await expect(
      portal.initialize(
        { checklistItemId: "00000000-0000-4000-8000-000000000007" },
        {
          sessionToken: "supplier-evidence-session-token-0123456789",
          fileName: "sbom.json",
          mediaType: "application/json",
          byteSize: 100,
          sha256: "a".repeat(64),
          idempotencyKey: "00000000-0000-4000-8000-000000000008",
        },
      ),
    ).rejects.toBeInstanceOf(expected);
  });

  it("preserves M3's already-sanitized validation errors", async () => {
    const failure = new BadRequestException("Invalid SBOM upload");
    sbom.complete.mockRejectedValue(failure);
    await expect(
      portal.complete(
        {
          checklistItemId: "00000000-0000-4000-8000-000000000007",
          sourceId: "00000000-0000-4000-8000-000000000005",
        },
        {
          sessionToken: "supplier-evidence-session-token-0123456789",
          idempotencyKey: "00000000-0000-4000-8000-000000000008",
        },
      ),
    ).rejects.toBe(failure);
  });
});

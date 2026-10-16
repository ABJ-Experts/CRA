import { failure, success } from "../../common/domain/result";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import { TechnicalFileAuditorAccessUseCases } from "./technical-file-auditor-access-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const snapshotId = "00000000-0000-4000-8000-000000000004";

describe("TechnicalFileAuditorAccessUseCases", () => {
  it("creates the opaque token only after product tenant scope is verified", async () => {
    const repository = { create: jest.fn().mockResolvedValue({ id: "grant" }) };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(success({ retention: {} })),
    };
    const useCases = new TechnicalFileAuditorAccessUseCases(
      repository as never,
      retention,
    );

    const created = await useCases.create(organizationId, {
      actorId,
      productId,
      snapshotId,
      exportId: "00000000-0000-4000-8000-000000000005",
      recipientEmail: "auditor@example.test",
      recipientReference: null,
      purpose: "Independent conformity assessment.",
      expiresAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: "00000000-0000-4000-8000-000000000006",
    });

    expect(created?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repository.create).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        actorId,
        productId,
        snapshotId,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
    expect(JSON.stringify(repository.create.mock.calls)).not.toContain(
      created?.token,
    );
  });

  it("never creates a grant for an unavailable product", async () => {
    const repository = { create: jest.fn() };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(failure(new Error("not found"))),
    };
    const useCases = new TechnicalFileAuditorAccessUseCases(
      repository as never,
      retention,
    );

    await expect(
      useCases.create(organizationId, {
        actorId,
        productId,
        snapshotId,
        exportId: "00000000-0000-4000-8000-000000000005",
        recipientEmail: "auditor@example.test",
        purpose: "Independent conformity assessment.",
        expiresAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: "00000000-0000-4000-8000-000000000006",
      }),
    ).rejects.toBeInstanceOf(TechnicalFileProductUnavailableError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("does not send a raw auditor session secret to the repository", async () => {
    const repository = {
      redeem: jest
        .fn()
        .mockResolvedValue({ expiresAt: "2026-09-15T10:10:00.000Z" }),
    };
    const useCases = new TechnicalFileAuditorAccessUseCases(
      repository as never,
      {} as never,
    );

    const redeemed = await useCases.redeem("A".repeat(43), "127.0.0.1");

    expect(redeemed?.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repository.redeem).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        sessionTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        clientSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
    expect(JSON.stringify(repository.redeem.mock.calls)).not.toContain(
      redeemed?.sessionToken,
    );
  });
});

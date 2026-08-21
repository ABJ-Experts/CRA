import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { SbomService } from "./sbom.service";

const success = Object.freeze({
  ok: true,
  value: Object.freeze({ job: Object.freeze({ id: "job" }) }),
});

function harness(result: unknown = success) {
  const useCases = Object.fromEntries(
    [
      "initialize",
      "complete",
      "job",
      "download",
      "listSourcesForRelease",
      "validationReport",
      "replay",
    ].map((name) => [name, jest.fn().mockResolvedValue(result)]),
  );
  const credentials = {
    create: jest.fn(),
    list: jest.fn(),
    revoke: jest.fn(),
  };
  return {
    service: new SbomService(useCases as never, credentials as never),
    useCases,
    credentials,
  };
}

describe("SbomService", () => {
  it.each([
    ["invalid_request", BadRequestException, 400],
    ["not_found", NotFoundException, 404],
    ["conflict", ConflictException, 409],
    ["idempotency_mismatch", ConflictException, 409],
    ["content_hash_mismatch", ConflictException, 409],
    ["source_missing", ConflictException, 409],
    ["unavailable", ServiceUnavailableException, 503],
  ] as const)(
    "maps %s to the stable SBOM error envelope",
    async (code, exception, status) => {
      const { service } = harness({ ok: false, error: { code } });

      await expect(
        service.validationReport({
          organizationId: "11111111-1111-4111-8111-111111111111",
          actorId: "22222222-2222-4222-8222-222222222222",
          sourceId: "33333333-3333-4333-8333-333333333333",
        }),
      ).rejects.toMatchObject({
        constructor: exception,
        status,
        response: {
          code,
          message: "SBOM intake request could not be completed.",
        },
      });
    },
  );

  it("returns an owner replay conflict without leaking worker or storage details", async () => {
    const { service } = harness({ ok: false, error: { code: "conflict" } });

    await expect(
      service.replay({
        organizationId: "11111111-1111-4111-8111-111111111111",
        actorId: "22222222-2222-4222-8222-222222222222",
        jobId: "33333333-3333-4333-8333-333333333333",
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "conflict",
        message: "SBOM intake request could not be completed.",
      },
    });
  });
});

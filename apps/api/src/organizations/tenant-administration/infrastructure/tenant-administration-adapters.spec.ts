import {
  ExistingAuthDestructiveReauthenticationAdapter,
  NodeTenantRequestIdentityAdapter,
  SupabaseMfaFactorReadinessAdapter,
  SupabaseTenantExportDownloadAdapter,
  SystemTenantClockAdapter,
} from "./tenant-administration-adapters";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";

function readinessAdapter(
  result: Readonly<{ data: unknown; error: unknown }>,
  listFactors = jest.fn(),
) {
  const members = {
    select: jest.fn(),
    eq: jest.fn(),
    then: undefined as unknown as PromiseLike<typeof result>["then"],
  };
  members.select.mockReturnValue(members);
  members.eq.mockReturnValue(members);
  members.then = ((resolve: (value: typeof result) => unknown) =>
    Promise.resolve(result).then(resolve)) as PromiseLike<
    typeof result
  >["then"];
  return new SupabaseMfaFactorReadinessAdapter({
    admin: () => ({
      from: () => members,
      auth: { admin: { mfa: { listFactors } } },
    }),
  } as never);
}

describe("tenant administration provider adapters", () => {
  it("derives PII-free readiness from every current member's verified factors", async () => {
    const membersResult = {
      data: [
        { users: { auth_user_id: "00000000-0000-4000-8000-000000000003" } },
        { users: { auth_user_id: "00000000-0000-4000-8000-000000000004" } },
      ],
      error: null,
    };
    const members = {
      select: jest.fn(),
      eq: jest.fn(),
      then: undefined as unknown as PromiseLike<typeof membersResult>["then"],
    };
    members.select.mockReturnValue(members);
    members.eq.mockReturnValue(members);
    members.then = ((resolve: (value: typeof membersResult) => unknown) =>
      Promise.resolve(membersResult).then(resolve)) as PromiseLike<
      typeof membersResult
    >["then"];
    const listFactors = jest
      .fn()
      .mockResolvedValueOnce({
        data: { factors: [{ status: "verified" }] },
        error: null,
      })
      .mockResolvedValueOnce({ data: { factors: [] }, error: null });
    const adapter = new SupabaseMfaFactorReadinessAdapter({
      admin: () => ({
        from: () => members,
        auth: { admin: { mfa: { listFactors } } },
      }),
    } as never);

    await expect(adapter.read(organizationId)).resolves.toEqual({
      enrolledMemberCount: 1,
      unenrolledMemberCount: 1,
      safeToEnforce: false,
    });
    expect(members.eq).toHaveBeenCalledWith("organization_id", organizationId);
  });

  it("requires a fresh six-digit MFA verification when the actor has a factor", async () => {
    const auth = { verifyPassword: jest.fn().mockResolvedValue(true) };
    const mfa = {
      hasVerifiedFactor: jest.fn().mockResolvedValue(true),
      verify: jest.fn().mockResolvedValue({}),
    };
    const adapter = new ExistingAuthDestructiveReauthenticationAdapter(
      auth as never,
      mfa as never,
    );
    const base = {
      email: "owner@cra.test",
      password: "not-persisted",
      accessToken: "access-token",
      actorId,
    };

    await expect(adapter.verify(base)).resolves.toEqual({
      outcome: "mfa_required",
    });
    await expect(
      adapter.verify({ ...base, mfaCode: "123456" }),
    ).resolves.toEqual({
      outcome: "verified",
    });
    expect(mfa.verify).toHaveBeenCalledWith("access-token", actorId, "123456");
  });

  it("reports safe-to-enforce when every member has a verified factor", async () => {
    const adapter = readinessAdapter(
      {
        data: [
          { users: { auth_user_id: "00000000-0000-4000-8000-000000000003" } },
        ],
        error: null,
      },
      jest.fn().mockResolvedValue({
        data: { factors: [{ status: "verified" }] },
        error: null,
      }),
    );

    await expect(adapter.read(organizationId)).resolves.toEqual({
      enrolledMemberCount: 1,
      unenrolledMemberCount: 0,
      safeToEnforce: true,
    });
  });

  it.each([
    ["member query failure", { data: null, error: { message: "private" } }],
    ["non-array member payload", { data: {}, error: null }],
  ] as const)("fails closed on %s", async (_label, result) => {
    await expect(
      readinessAdapter(result).read(organizationId),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("rejects malformed joined member rows", async () => {
    await expect(
      readinessAdapter({
        data: [{ users: null }],
        error: null,
      }).read(organizationId),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it.each([
    [{ data: null, error: { message: "private" } }],
    [{ data: null, error: null }],
  ] as const)(
    "fails closed on malformed factor responses",
    async (factorResult) => {
      const adapter = readinessAdapter(
        {
          data: [
            { users: { auth_user_id: "00000000-0000-4000-8000-000000000003" } },
          ],
          error: null,
        },
        jest.fn().mockResolvedValue(factorResult),
      );

      await expect(adapter.read(organizationId)).rejects.toMatchObject({
        code: "unavailable",
      });
    },
  );

  it("maps unexpected readiness exceptions to an unavailable provider error", async () => {
    const adapter = new SupabaseMfaFactorReadinessAdapter({
      admin: () => {
        throw new Error("private provider failure");
      },
    } as never);

    await expect(adapter.read(organizationId)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("accepts a fresh password without MFA when no verified factor exists", async () => {
    const adapter = new ExistingAuthDestructiveReauthenticationAdapter(
      { verifyPassword: jest.fn().mockResolvedValue(true) } as never,
      {
        hasVerifiedFactor: jest.fn().mockResolvedValue(false),
        verify: jest.fn(),
      } as never,
    );

    await expect(
      adapter.verify({
        email: "owner@cra.test",
        password: "secret",
        accessToken: "access-token",
        actorId,
      }),
    ).resolves.toEqual({ outcome: "verified" });
  });

  it("distinguishes invalid credentials/MFA from unavailable auth", async () => {
    const invalidPassword = new ExistingAuthDestructiveReauthenticationAdapter(
      { verifyPassword: jest.fn().mockResolvedValue(false) } as never,
      {} as never,
    );
    const invalidMfa = new ExistingAuthDestructiveReauthenticationAdapter(
      { verifyPassword: jest.fn().mockResolvedValue(true) } as never,
      {
        hasVerifiedFactor: jest.fn().mockResolvedValue(true),
        verify: jest.fn().mockRejectedValue({ getStatus: () => 401 }),
      } as never,
    );
    const unavailable = new ExistingAuthDestructiveReauthenticationAdapter(
      {
        verifyPassword: jest.fn().mockRejectedValue(new Error("outage")),
      } as never,
      {} as never,
    );
    const input = {
      email: "owner@cra.test",
      password: "secret",
      accessToken: "access-token",
      actorId,
      mfaCode: "123456",
    };

    await expect(invalidPassword.verify(input)).resolves.toEqual({
      outcome: "invalid_password",
    });
    await expect(invalidMfa.verify(input)).resolves.toEqual({
      outcome: "invalid_mfa",
    });
    await expect(unavailable.verify(input)).resolves.toEqual({
      outcome: "unavailable",
    });
  });

  it("issues only an audited HTTPS attachment link for a verified org export", async () => {
    const builder = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          status: "completed",
          verified_at: "2026-08-10T00:00:00.000Z",
          artifact_object_path: `${organizationId}/export.zip`,
          artifact_sha256: "a".repeat(64),
        },
        error: null,
      }),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl: "https://storage.example.test/export.zip?signature=opaque",
      },
      error: null,
    });
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ outcome: "found" }], error: null });
    const adapter = new SupabaseTenantExportDownloadAdapter({
      admin: () => ({
        from: () => builder,
        storage: { from: () => ({ createSignedUrl }) },
        rpc,
      }),
    } as never);

    await expect(
      adapter.createDownload(organizationId, actorId, actorId),
    ).resolves.toEqual({
      outcome: "available",
      download: {
        url: "https://storage.example.test/export.zip?signature=opaque",
        filename: "organization-export-v1.zip",
        expiresInSeconds: 900,
      },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${organizationId}/export.zip`,
      900,
      {
        download: "organization-export-v1.zip",
      },
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_organization_export_download_atomic",
      {
        p_organization_id: organizationId,
        p_export_job_id: actorId,
        p_actor_user_id: actorId,
      },
    );
  });

  it("fails closed if storage returns a non-HTTPS link or the audit fails", async () => {
    const builder = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          status: "completed",
          verified_at: "2026-08-10T00:00:00.000Z",
          artifact_object_path: `${organizationId}/export.zip`,
          artifact_sha256: "a".repeat(64),
        },
        error: null,
      }),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    const adapter = new SupabaseTenantExportDownloadAdapter({
      admin: () => ({
        from: () => builder,
        storage: {
          from: () => ({
            createSignedUrl: jest.fn().mockResolvedValue({
              data: { signedUrl: "http://storage.example.test/private.zip" },
              error: null,
            }),
          }),
        },
        rpc: jest.fn(),
      }),
    } as never);

    await expect(
      adapter.createDownload(organizationId, actorId, actorId),
    ).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("generates a server-only digest/correlation identity and exposes a clock seam", () => {
    const identity = new NodeTenantRequestIdentityAdapter().create({
      organizationId,
      actorId,
      idempotencyKey: "00000000-0000-4000-8000-000000000007",
    });

    expect(identity.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new SystemTenantClockAdapter().now()).toBeInstanceOf(Date);
  });
});

/* eslint-disable @typescript-eslint/require-await -- Promise-shaped test doubles intentionally resolve immediately. */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  recoveryProbeFetch,
  runRecoveryProbe,
  verifyRecoveryApplication,
  type RecoveryProbeRuntimeConfiguration,
} from "./recovery-probe-runtime";
jest.mock("@supabase/supabase-js", () => ({ createClient: jest.fn() }));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config: RecoveryProbeRuntimeConfiguration = {
  endpoints: {
    auth: `http://cra-backup-probe-${id(1)}-auth:9999`,
    rest: `http://cra-backup-probe-${id(1)}-rest:3000`,
    storage: `http://cra-backup-probe-${id(1)}-storage:5000`,
  },
  serviceKey: "x".repeat(150),
  identities: [
    { email: "one@recovery.invalid", password: "x".repeat(40) },
    { email: "two@recovery.invalid", password: "y".repeat(40) },
  ],
  fixture: {
    organizationId: id(2),
    otherOrganizationId: id(3),
    productId: id(4),
    otherProductId: id(5),
    documentId: id(6),
    versionId: id(7),
  },
  profileIds: [id(8), id(9)],
};
const token =
  Buffer.from(JSON.stringify({ alg: "ES256" })).toString("base64url") +
  ".payload.signature";
function fake() {
  const bytes = Buffer.from("Restored evidence.");
  const source = {
    versionId: id(7),
    objectKey: `${id(2)}/${id(6)}/${id(7)}/${id(10)}`,
    filename: "evidence.txt",
    mediaType: "text/plain",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
    mode: "download",
  };
  const auth = {
    signInWithPassword: jest.fn(async () => ({
      data: { session: { access_token: token, user: { id: id(11) } } },
      error: null,
    })),
    getUser: jest.fn(async () => ({
      data: { user: { id: id(11) } },
      error: null,
    })),
    admin: {
      createUser: jest.fn(async () => ({
        data: { user: { id: id(11) } },
        error: null,
      })),
    },
  };
  const rpc = jest.fn(async (name: string, args: Record<string, unknown>) => ({
    data: [
      {
        outcome:
          args.p_actor_user_id === id(9) || args.p_product_id === id(5)
            ? "forbidden"
            : name.startsWith("authorize")
              ? "authorized"
              : "redeemed",
        result: source,
      },
    ],
    error: null,
  }));
  const download = jest.fn(async () => ({
    data: new Blob([bytes]),
    error: null,
  }));
  const eq = jest.fn(async (_column: string, value: string) => ({
    data: value === id(2) ? [{ organization_id: id(2) }] : [],
    error: null,
  }));
  const value = {
    auth,
    rpc,
    from: () => ({ select: () => ({ eq }) }),
    storage: { from: () => ({ download }) },
  } as unknown as SupabaseClient;
  return { value, auth, rpc, download, eq, source };
}
describe("target-only HTTP destination policy", () => {
  it.each([
    "/auth/v1/token?grant_type=password",
    "/rest/v1/rpc/authorize",
    "/storage/v1/object/evidence-documents/key",
  ])("rewrites only internal routes %s", async (path) => {
    const transport = jest.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        void input;
        void init;
        return new Response("{}");
      },
    );
    await recoveryProbeFetch(
      config.endpoints,
      transport,
    )("http://recovery.invalid" + path);
    expect(transport.mock.calls[0]![0]).toEqual(
      expect.stringContaining("http://cra-backup-probe-"),
    );
    expect(transport.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
  it("preserves request bodies and rejects external or unrecognized destinations", async () => {
    const transport = jest.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        void input;
        void init;
        return new Response("{}");
      },
    );
    const fetcher = recoveryProbeFetch(config.endpoints, transport);
    await fetcher(
      new Request("http://recovery.invalid/rest/v1/rpc/test", {
        method: "POST",
        body: "{}",
      }),
      { signal: new AbortController().signal },
    );
    expect(transport.mock.calls[0]![0]).toBeInstanceOf(Request);
    await expect(fetcher("https://example.com/auth/v1/token")).rejects.toThrow(
      "recovery_probe_destination",
    );
    await expect(fetcher("http://recovery.invalid/arbitrary")).rejects.toThrow(
      "recovery_probe_destination",
    );
  });
});
describe("real M8 use-case recovery probes", () => {
  it("requires real ES256 login, RLS tenant denial, product binding, grant redemption and verified bytes", async () => {
    const t = fake();
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).resolves.toEqual({
      checks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
        "private_evidence_access",
      ],
    });
    expect(t.rpc).toHaveBeenCalledWith(
      "redeem_evidence_document_access_atomic",
      expect.objectContaining({
        p_organization_id: id(2),
        p_actor_user_id: id(8),
      }),
    );
    expect(t.download).toHaveBeenCalledWith(t.source.objectKey);
  });
  it("requires fresh target profiles", async () => {
    const t = fake();
    await expect(
      verifyRecoveryApplication(
        { ...config, profileIds: undefined },
        t.value,
        () => t.value,
      ),
    ).rejects.toMatchObject({ failedCheck: "authentication" });
  });
  it("rejects failed auth and wrong algorithms", async () => {
    const t = fake();
    t.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "failure" },
    } as never);
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).rejects.toMatchObject({ failedCheck: "authentication" });
    t.auth.signInWithPassword.mockResolvedValueOnce({
      data: {
        session: {
          access_token:
            Buffer.from('{"alg":"HS256"}').toString("base64url") + ".a.b",
          user: { id: id(11) },
        },
      },
      error: null,
    });
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).rejects.toMatchObject({ failedCheck: "authentication" });
  });
  it("rejects failed token identity verification", async () => {
    const t = fake();
    t.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "revoked" },
    } as never);
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).rejects.toMatchObject({ failedCheck: "authentication" });
  });
  it("rejects authenticated cross-tenant disclosure", async () => {
    const t = fake();
    t.eq.mockResolvedValue({ data: [{ organization_id: id(3) }], error: null });
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).rejects.toMatchObject({ failedCheck: "tenant_isolation" });
  });
  it("rejects M8 cross-tenant and cross-product authorization regressions", async () => {
    for (const bypass of [id(9), id(5)]) {
      const t = fake();
      const original = t.rpc.getMockImplementation()!;
      t.rpc.mockImplementation(async (name, args) =>
        args.p_actor_user_id === bypass || args.p_product_id === bypass
          ? { data: [{ outcome: "authorized", result: t.source }], error: null }
          : original(name, args),
      );
      await expect(
        verifyRecoveryApplication(config, t.value, () => t.value),
      ).rejects.toMatchObject({
        failedCheck:
          bypass === id(9) ? "tenant_isolation" : "product_isolation",
      });
    }
  });
  it.each(["tenant", "product"])(
    "does not treat a %s provider conflict as isolation proof",
    async (kind) => {
      const t = fake();
      const original = t.rpc.getMockImplementation()!;
      t.rpc.mockImplementation(async (name, args) =>
        (
          kind === "tenant"
            ? args.p_actor_user_id === id(9)
            : args.p_product_id === id(5)
        )
          ? { data: [{ outcome: "conflict", result: t.source }], error: null }
          : original(name, args),
      );
      await expect(
        verifyRecoveryApplication(config, t.value, () => t.value),
      ).rejects.toMatchObject({
        failedCheck:
          kind === "tenant" ? "tenant_isolation" : "product_isolation",
        completedChecks:
          kind === "tenant"
            ? ["authentication"]
            : ["authentication", "tenant_isolation"],
      });
    },
  );
  it.each(["authorize", "redeem"])(
    "rejects missing %s authority",
    async (phase) => {
      const t = fake();
      const original = t.rpc.getMockImplementation()!;
      t.rpc.mockImplementation(async (name, args) =>
        name.startsWith(phase) &&
        args.p_actor_user_id === id(8) &&
        args.p_product_id !== id(5)
          ? { data: [], error: null }
          : original(name, args),
      );
      await expect(
        verifyRecoveryApplication(config, t.value, () => t.value),
      ).rejects.toMatchObject({ failedCheck: "private_evidence_access" });
    },
  );
  it("rejects corrupt restored private bytes", async () => {
    const t = fake();
    t.download.mockResolvedValue({
      data: new Blob(["corruption"]),
      error: null,
    });
    await expect(
      verifyRecoveryApplication(config, t.value, () => t.value),
    ).rejects.toMatchObject({
      failedCheck: "private_evidence_access",
      completedChecks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
      ],
    });
  });
});
describe("isolated Node entry point", () => {
  let dir: string;
  const originalFetch = global.fetch;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "recovery-probe-runtime-"));
    jest
      .mocked(createClient)
      .mockReturnValue(
        fake().value as unknown as ReturnType<typeof createClient>,
      );
    global.fetch = jest.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        void input;
        void init;
        return new Response("{}");
      },
    );
  });
  afterEach(async () => {
    global.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
    jest.clearAllMocks();
  });
  async function file(value: unknown = config) {
    const path = join(dir, "probe.json");
    await writeFile(path, JSON.stringify(value));
    return path;
  }
  it("creates new identities through GoTrue admin, without source credentials", async () => {
    await expect(runRecoveryProbe("create", await file())).resolves.toEqual({
      authUserIds: [id(11), id(11)],
    });
    const call = jest.mocked(createClient).mock.calls[0]!;
    expect(call[0]).toBe("http://recovery.invalid");
    expect(call[1]).toBe(config.serviceKey);
    expect(call[2]?.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
    });
  });
  it("executes actual verification phase", async () => {
    await expect(runRecoveryProbe("verify", await file())).resolves.toEqual({
      checks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
        "private_evidence_access",
      ],
    });
  });
  it("rejects invalid phases and unsafe configuration", async () => {
    await expect(runRecoveryProbe("shell", await file())).rejects.toThrow(
      "recovery_probe_phase",
    );
    await expect(
      runRecoveryProbe(
        "verify",
        await file({
          ...config,
          endpoints: {
            ...config.endpoints,
            auth: "https://production.example",
          },
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejects identity creation errors", async () => {
    const t = fake();
    t.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "unsafe" },
    } as never);
    jest
      .mocked(createClient)
      .mockReturnValue(t.value as unknown as ReturnType<typeof createClient>);
    await expect(runRecoveryProbe("create", await file())).rejects.toThrow(
      "recovery_probe_identity",
    );
  });
});

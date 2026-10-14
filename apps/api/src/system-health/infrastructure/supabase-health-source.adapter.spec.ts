import { SupabaseHealthSourceAdapter } from "./supabase-health-source.adapter";
const stamp = "2026-10-14T00:00:00.000Z";
it("scopes source RPC to verified org and actor and cancels actual query", async () => {
  const abortSignal = jest.fn().mockResolvedValue({
    error: null,
    data: {
      outcome: "withheld",
      source: "licensing",
      sourceAt: null,
      observedAt: stamp,
      data: null,
      reasons: ["source_permission_withheld"],
    },
  });
  const rpc = jest.fn().mockReturnValue({ abortSignal });
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({ rpc }),
    } as never,
    {} as never,
  );
  const signal = new AbortController().signal;
  await expect(
    adapter.readSource("org", "actor", "licensing", signal),
  ).resolves.toMatchObject({ outcome: "withheld", data: null });
  expect(rpc).toHaveBeenCalledWith("m15_03_read_health_source", {
    p_organization_id: "org",
    p_actor_user_id: "actor",
    p_source: "licensing",
  });
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
it.each([
  { error: { message: "secret" }, data: null },
  {
    error: null,
    data: {
      outcome: "ready",
      source: "other",
      sourceAt: null,
      observedAt: stamp,
      data: {},
      reasons: [],
    },
  },
])("rejects error and malformed provider results safely", async (result) => {
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({ abortSignal: () => Promise.resolve(result) }),
      }),
    } as never,
    {} as never,
  );
  await expect(
    adapter.readSource(
      "org",
      "actor",
      "licensing",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Source observation unavailable");
});
it("delegates permitted licensing diagnostics to existing verifier and strips claims", async () => {
  const getCurrent = jest.fn().mockResolvedValue({
    policy: {
      state: "expired_read_only",
      expiresAt: stamp,
      graceEndsAt: stamp,
      evaluatedAt: stamp,
    },
    claims: { private: "raw" },
    digest: "secret",
  });
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({
          abortSignal: () =>
            Promise.resolve({
              error: null,
              data: {
                outcome: "ready",
                source: "licensing",
                sourceAt: null,
                observedAt: stamp,
                data: {},
                reasons: [],
              },
            }),
        }),
      }),
    } as never,
    { getCurrent } as never,
  );
  const signal = new AbortController().signal;
  const result = await adapter.readSource("org", "actor", "licensing", signal);
  expect(getCurrent).toHaveBeenCalledWith("org", "actor", signal);
  expect(result.data).toMatchObject({
    licence: { state: "expired_read_only", sourceAt: stamp },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(JSON.stringify(result)).not.toContain("raw");
});
it("never calls verifier for withheld licence authority", async () => {
  const getCurrent = jest.fn();
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({
          abortSignal: () =>
            Promise.resolve({
              error: null,
              data: {
                outcome: "withheld",
                source: "licensing",
                sourceAt: null,
                observedAt: stamp,
                data: null,
                reasons: ["source_permission_withheld"],
              },
            }),
        }),
      }),
    } as never,
    { getCurrent } as never,
  );
  await adapter.readSource(
    "org",
    "actor",
    "licensing",
    new AbortController().signal,
  );
  expect(getCurrent).not.toHaveBeenCalled();
});
it("rejects a malformed forbidden observation without treating it as a grant", async () => {
  const getCurrent = jest.fn();
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({
          abortSignal: () =>
            Promise.resolve({
              error: null,
              data: {
                outcome: "forbidden",
                source: "licensing",
                observedAt: stamp,
                data: null,
                reasons: ["source_permission_withheld"],
              },
            }),
        }),
      }),
    } as never,
    { getCurrent } as never,
  );
  await expect(
    adapter.readSource(
      "org",
      "actor",
      "licensing",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Source observation unavailable");
  expect(getCurrent).not.toHaveBeenCalled();
});
it("preserves a valid forbidden outcome for the application denial boundary", async () => {
  const getCurrent = jest.fn();
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({
          abortSignal: () =>
            Promise.resolve({
              error: null,
              data: {
                outcome: "forbidden",
                source: "licensing",
                sourceAt: null,
                observedAt: null,
                data: null,
                reasons: ["source_permission_withheld"],
              },
            }),
        }),
      }),
    } as never,
    { getCurrent } as never,
  );
  await expect(
    adapter.readSource(
      "org",
      "actor",
      "licensing",
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({ outcome: "forbidden", sourceAt: null });
  expect(getCurrent).not.toHaveBeenCalled();
});
it("preserves SQL authorization failure as a forbidden observation", async () => {
  const getCurrent = jest.fn();
  const adapter = new SupabaseHealthSourceAdapter(
    {
      admin: () => ({
        rpc: () => ({
          abortSignal: () =>
            Promise.resolve({
              error: { code: "42501", message: "private identity revoked" },
              data: null,
            }),
        }),
      }),
    } as never,
    { getCurrent } as never,
  );
  await expect(
    adapter.readSource(
      "org",
      "actor",
      "licensing",
      new AbortController().signal,
    ),
  ).resolves.toEqual({
    outcome: "forbidden",
    source: "licensing",
    sourceAt: null,
    observedAt: null,
    data: null,
    reasons: ["source_permission_withheld"],
  });
  expect(getCurrent).not.toHaveBeenCalled();
});

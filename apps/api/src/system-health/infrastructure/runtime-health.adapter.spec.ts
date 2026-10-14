import { RuntimeHealthAdapter } from "./runtime-health.adapter";
it("passes cancellation to incumbent probes and read-only storage request", async () => {
  const signal = new AbortController().signal;
  const ping = jest.fn().mockResolvedValue(true);
  const isReady = jest.fn().mockResolvedValue(true);
  const cancel = jest.fn().mockResolvedValue(undefined);
  const fetcher = jest.fn().mockResolvedValue({ ok: true, body: { cancel } });
  const adapter = new RuntimeHealthAdapter(
    { ping } as never,
    { isReady } as never,
    {
      getOrThrow: (key: string) =>
        key === "SUPABASE_URL" ? "http://127.0.0.1:54321" : "private",
    } as never,
    fetcher,
  );
  expect(await adapter.database(signal)).toBe(true);
  expect(await adapter.audit(signal)).toBe(true);
  expect(await adapter.storage(signal)).toBe(true);
  expect(ping).toHaveBeenCalledWith(signal);
  expect(isReady).toHaveBeenCalledWith(signal);
  expect(fetcher).toHaveBeenCalledWith(
    "http://127.0.0.1:54321/storage/v1/bucket",
    expect.objectContaining({ method: "GET", signal, redirect: "error" }),
  );
  expect(cancel).toHaveBeenCalled();
});
it("reports storage failure without creating or deleting objects", async () => {
  const adapter = new RuntimeHealthAdapter(
    {} as never,
    {} as never,
    { getOrThrow: () => "http://127.0.0.1:54321" } as never,
    jest.fn().mockResolvedValue({ ok: false, body: null }),
  );
  expect(await adapter.storage(new AbortController().signal)).toBe(false);
});

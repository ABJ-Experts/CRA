import { PrivateMetadataTransport } from "./operator-transport";
const target = {
  instanceId: "20000000-0000-4000-8000-000000000001",
  endpoint: "https://127.0.0.1:3444",
  ca: Buffer.alloc(0),
  cert: Buffer.alloc(0),
  key: Buffer.alloc(0),
};
describe("fixed private HTTPS transport", () => {
  it("denies public HTTP, public IP, DNS and arbitrary API paths before egress", async () => {
    const transport = new PrivateMetadataTransport();
    for (const endpoint of [
      "http://127.0.0.1:3444",
      "https://8.8.8.8",
      "https://public.example",
      "https://127.0.0.1/api/v1/auth/me",
      "https://user:secret@127.0.0.1",
      "https://127.0.0.1?redirect=1",
    ])
      await expect(
        transport.read({ ...target, endpoint }, null, AbortSignal.timeout(100)),
      ).rejects.toThrow();
  });
  it("honors cancellation before connecting", async () => {
    const signal = AbortSignal.abort();
    await expect(
      new PrivateMetadataTransport().read(target, null, signal),
    ).rejects.toThrow();
  });
});

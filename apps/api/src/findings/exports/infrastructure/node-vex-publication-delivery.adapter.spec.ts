import { createHash } from "node:crypto";

import { NodeVexPublicationDeliveryAdapter } from "./node-vex-publication-delivery.adapter";
import { ConfiguredVexPublicationTargetRegistry } from "./configured-vex-publication-target-registry";

const payload = Buffer.from("payload");
const contentSha256 = createHash("sha256").update(payload).digest("hex");
const claim = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  workerId: "33333333-3333-4333-8333-333333333333",
  eventKey:
    "vex-publication:publish:22222222-2222-4222-8222-222222222222:33333333-3333-4333-8333-333333333333",
  kind: "publish" as const,
  targetKey: "published-vex",
  storageBucket: "tenant-exports" as const,
  storageObjectPath: `11111111-1111-4111-8111-111111111111/vex/openvex/0_2_0/${contentSha256}.json`,
  contentSha256,
  format: "openvex" as const,
};

describe("NodeVexPublicationDeliveryAdapter", () => {
  it("pins public DNS and rejects redirects rather than following them", async () => {
    const put = jest.fn().mockResolvedValue({ status: 302 });
    const adapter = new NodeVexPublicationDeliveryAdapter(
      {
        readImmutable: jest.fn().mockResolvedValue(payload),
        putImmutable: jest.fn(),
      },
      new ConfiguredVexPublicationTargetRegistry(
        JSON.stringify([
          {
            targetKey: "published-vex",
            label: "Published VEX",
            kind: "https_put",
            versionedUrlTemplate:
              "https://publish.example.test/vex/{organizationId}/{sha256}.json",
            pointerUrl: "https://publish.example.test/current.json",
            allowedHosts: ["publish.example.test"],
          },
        ]),
      ),
      {} as never,
      { lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]) },
      put,
    );
    await expect(adapter.deliver(claim)).rejects.toThrow("rejected");
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "8.8.8.8",
        idempotencyKey: claim.eventKey,
      }),
    );
  });

  it("rejects a DNS-rebound private address before egress", async () => {
    const put = jest.fn();
    const adapter = new NodeVexPublicationDeliveryAdapter(
      {
        readImmutable: jest.fn().mockResolvedValue(payload),
        putImmutable: jest.fn(),
      },
      new ConfiguredVexPublicationTargetRegistry(
        JSON.stringify([
          {
            targetKey: "published-vex",
            label: "Published VEX",
            kind: "https_put",
            versionedUrlTemplate:
              "https://publish.example.test/vex/{organizationId}/{sha256}.json",
            pointerUrl: "https://publish.example.test/current.json",
            allowedHosts: ["publish.example.test"],
          },
        ]),
      ),
      {} as never,
      { lookup: jest.fn().mockResolvedValue([{ address: "127.0.0.1" }]) },
      put,
    );
    await expect(adapter.deliver(claim)).rejects.toThrow("egress blocked");
    expect(put).not.toHaveBeenCalled();
  });

  it("writes only a tombstone pointer when withdrawing", async () => {
    type Upload = (
      path: string,
      body: Buffer,
      options: Readonly<{ contentType?: string; upsert?: boolean }>,
    ) => Promise<{ error: null }>;
    const upload: jest.MockedFunction<Upload> = jest
      .fn<ReturnType<Upload>, Parameters<Upload>>()
      .mockResolvedValue({ error: null });
    const adapter = new NodeVexPublicationDeliveryAdapter(
      { readImmutable: jest.fn(), putImmutable: jest.fn() },
      new ConfiguredVexPublicationTargetRegistry(
        JSON.stringify([
          {
            targetKey: "published-vex",
            label: "Published VEX",
            kind: "supabase_storage",
            bucket: "published",
            prefix: "vex",
          },
        ]),
      ),
      { admin: () => ({ storage: { from: () => ({ upload }) } }) } as never,
    );
    await adapter.deliver({ ...claim, kind: "withdraw" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(
      `vex/${claim.organizationId}/current.json`,
      expect.any(Buffer),
      expect.objectContaining({ upsert: true }),
    );
    const body = upload.mock.calls[0]?.[1];
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body?.toString("utf8")).toBe('{"version":1,"withdrawn":true}');
  });
});

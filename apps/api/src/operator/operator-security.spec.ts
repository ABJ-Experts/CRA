import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OperatorGrantStore,
  authorizeOperatorSocket,
  privateAddress,
} from "./operator-security";
const principalId = "10000000-0000-4000-8000-000000000001";
const instanceId = "20000000-0000-4000-8000-000000000001";
const fingerprint = "AA:".repeat(31) + "AA";
const cert = {
  fingerprint256: fingerprint,
  valid_from: "Jan 1 00:00:00 2020 GMT",
  valid_to: "Jan 1 00:00:00 2040 GMT",
};
const grants = {
  revision: "r1",
  grants: [
    {
      fingerprint256: fingerprint,
      principalId,
      instanceIds: [instanceId],
      tenantScopes: [
        { instanceId, tenantIds: ["30000000-0000-4000-8000-000000000001"] },
      ],
    },
  ],
};
describe("operator raw TLS identity", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "operator-grants-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("reads grants afresh so revocation applies to an authorized keepalive socket", async () => {
    const path = join(directory, "grants.json");
    await writeFile(path, JSON.stringify(grants));
    const store = new OperatorGrantStore(path);
    const socket = {
      encrypted: true,
      authorized: true,
      getPeerCertificate: () => cert,
    };
    expect((await authorizeOperatorSocket(socket, store)).principalId).toBe(
      principalId,
    );
    await writeFile(path, JSON.stringify({ ...grants, grants: [] }));
    await expect(authorizeOperatorSocket(socket, store)).rejects.toThrow(
      "Operator certificate denied",
    );
  });
  it("denies unverified, missing, expired and not-yet-valid certificates", async () => {
    const path = join(directory, "grants.json");
    await writeFile(path, JSON.stringify(grants));
    const store = new OperatorGrantStore(path);
    for (const socket of [
      {},
      { encrypted: true, authorized: false },
      { encrypted: true, authorized: true, getPeerCertificate: () => ({}) },
      {
        encrypted: true,
        authorized: true,
        getPeerCertificate: () => ({
          ...cert,
          valid_to: "Jan 1 00:00:00 2001 GMT",
        }),
      },
      {
        encrypted: true,
        authorized: true,
        getPeerCertificate: () => ({
          ...cert,
          valid_from: "Jan 1 00:00:00 2041 GMT",
        }),
      },
    ]) {
      await expect(authorizeOperatorSocket(socket, store)).rejects.toThrow();
    }
  });
  it("fails closed on malformed or duplicate grants and never grants defaults", async () => {
    const path = join(directory, "grants.json");
    const store = new OperatorGrantStore(path);
    for (const data of [
      { ...grants, role: "owner" },
      { ...grants, grants: [grants.grants[0], grants.grants[0]] },
      { ...grants, grants: [{ ...grants.grants[0], principalId: "owner" }] },
    ]) {
      await writeFile(path, JSON.stringify(data));
      await expect(store.read()).rejects.toThrow();
    }
  });
  it("permits only private literal addresses", () => {
    for (const host of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.1.2",
      "192.168.1.2",
      "::1",
      "fd00::1",
    ])
      expect(privateAddress(host)).toBe(true);
    for (const host of [
      "0.0.0.0",
      "::",
      "8.8.8.8",
      "example.com",
      "172.32.0.1",
      "10.999.0.1",
    ])
      expect(privateAddress(host)).toBe(false);
  });
});
it("rejects an oversized mounted grant without attempting grant decoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-grants-cap-"));
  try {
    const path = join(directory, "grants.json");
    await writeFile(path, " ".repeat(1024 * 1024 + 1));
    await expect(new OperatorGrantStore(path).read()).rejects.toThrow(
      "Operator mount exceeds bound",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

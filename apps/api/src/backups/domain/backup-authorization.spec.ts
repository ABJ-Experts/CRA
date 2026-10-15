import { grantsSchema } from "../../operator/domain/operator-grants";
import {
  authorizeBackupAction,
  assertPrivateMutation,
} from "./backup-authorization";
const instance = "20000000-0000-4000-8000-000000000001";
const identity = () => ({
  ...grantsSchema.parse({
    revision: "r1",
    grants: [
      {
        fingerprint256: "AA:".repeat(31) + "AA",
        principalId: "10000000-0000-4000-8000-000000000001",
        instanceIds: [instance],
        tenantScopes: [],
      },
    ],
  }).grants[0]!,
  revision: "r1",
});
describe("backup execution authority", () => {
  it("preserves metadata grants without granting backup actions", () => {
    expect(() =>
      authorizeBackupAction(identity(), instance, instance, "backups.view"),
    ).toThrow("Backup scope unavailable");
  });
  it("requires explicit action and matching mounted instance", () => {
    const granted = {
      ...identity(),
      backupScopes: [
        { instanceId: instance, actions: ["backups.view" as const] },
      ],
    };
    expect(() =>
      authorizeBackupAction(granted, instance, instance, "backups.view"),
    ).not.toThrow();
    expect(() =>
      authorizeBackupAction(granted, instance, instance, "backups.run"),
    ).toThrow();
    expect(() =>
      authorizeBackupAction(
        granted,
        "30000000-0000-4000-8000-000000000001",
        instance,
        "backups.view",
      ),
    ).toThrow();
  });
  it("rejects foreign, missing and ambiguous browser mutation origins", () => {
    for (const origin of [
      undefined,
      "null",
      "http://127.0.0.1:3444",
      "https://evil.test",
      "https://127.0.0.1:3444/path",
    ]) {
      expect(() =>
        assertPrivateMutation({
          method: "POST",
          headers: {
            origin,
            host: "127.0.0.1:3444",
            "content-type": "application/json",
          },
        }),
      ).toThrow();
    }
    expect(() =>
      assertPrivateMutation({
        method: "POST",
        headers: {
          origin: "https://127.0.0.1:3444",
          host: "127.0.0.1:3444",
          "content-type": "application/json; charset=utf-8",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertPrivateMutation({
        method: "POST",
        headers: {
          origin: "https://127.0.0.1:3444",
          host: "127.0.0.1:3444",
          "content-type": "text/plain",
        },
      }),
    ).toThrow();
    expect(() =>
      assertPrivateMutation({ method: "GET", headers: {} }),
    ).not.toThrow();
  });
  it("validates unique action scopes inside the metadata instance grant", () => {
    const base = identity();
    for (const backupScopes of [
      [{ instanceId: instance, actions: ["backups.run", "backups.run"] }],
      [
        {
          instanceId: "30000000-0000-4000-8000-000000000001",
          actions: ["backups.run"],
        },
      ],
    ]) {
      expect(
        grantsSchema.safeParse({
          revision: "r1",
          grants: [{ ...base, revision: undefined, backupScopes }],
        }).success,
      ).toBe(false);
    }
  });
});

import { SiemVault } from "./siem-vault";
import { AesGcmConnectorVault } from "../../../connectors/infrastructure/connector-vault";
const context = {
  orgId: "10000000-0000-4000-8000-000000000001",
  destinationId: "10000000-0000-4000-8000-000000000002",
  credentialId: "10000000-0000-4000-8000-000000000003",
  credentialRevision: 1,
};
const vault = () =>
  new SiemVault(
    new AesGcmConnectorVault(
      JSON.stringify({
        activeKeyId: "one",
        keys: { one: Buffer.alloc(32, 1).toString("base64") },
      }),
    ),
  );
describe("SIEM credential vault", () => {
  it("encrypts typed bundles and exposes no credential in envelope", () => {
    const v = vault();
    const credential = { mode: "bearer" as const, token: "secret-canary" };
    const e = v.encrypt(context, credential);
    expect(JSON.stringify(e)).not.toContain("secret-canary");
    expect(v.decrypt(context, e)).toEqual(credential);
    expect(v.available()).toBe(true);
    expect(v.keyIds()).toEqual(["one"]);
    expect(
      v.fingerprint(context.orgId, context.destinationId, "request"),
    ).toEqual(v.fingerprint(context.orgId, context.destinationId, "request"));
  });
  it.each([
    "orgId",
    "destinationId",
    "credentialId",
    "credentialRevision",
  ] as const)("binds %s", (key) => {
    const v = vault();
    const e = v.encrypt(context, { mode: "bearer", token: "secret" });
    expect(() =>
      v.decrypt(
        {
          ...context,
          [key]:
            key === "credentialRevision"
              ? 2
              : "10000000-0000-4000-8000-000000000099",
        },
        e,
      ),
    ).toThrow();
  });
  it("rejects malformed contexts and credentials", () => {
    const v = vault();
    expect(() =>
      v.encrypt(
        { ...context, orgId: "forged" },
        { mode: "bearer", token: "secret" },
      ),
    ).toThrow();
    expect(() =>
      v.encrypt(context, { mode: "bearer", token: "\r\n" }),
    ).toThrow();
    expect(() =>
      v.fingerprint("bad", context.destinationId, "request"),
    ).toThrow();
  });
});

it("rejects PEM-shaped invalid client credentials", () => {
  expect(() =>
    vault().encrypt(context, {
      mode: "mtls",
      certificate:
        "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
      privateKey:
        "-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----",
    }),
  ).toThrow();
});

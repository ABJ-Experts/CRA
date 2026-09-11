import { generateKeyPairSync, verify } from "node:crypto";

import { ReportingEvidenceSigner } from "./reporting-evidence-signer";

describe("ReportingEvidenceSigner", () => {
  it("creates an independently verifiable detached Ed25519 signature", () => {
    const pair = generateKeyPairSync("ed25519");
    const publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const signer = new ReportingEvidenceSigner({ keyId: "reporting-2026", privateKey, publicKey });
    const bytes = Buffer.from("CRA-REPORTING-PACKAGE-V1\\nmanifest", "utf8");
    const signed = signer.sign(bytes);

    expect(signed.algorithm).toBe("Ed25519");
    expect(signed.publicKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(verify(null, bytes, publicKey, signed.signature)).toBe(true);
  });

  it("accepts PEM values encoded with literal newlines for quoted environment variables", () => {
    const pair = generateKeyPairSync("ed25519");
    const publicKey = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const signer = new ReportingEvidenceSigner({
      keyId: "reporting-2026",
      privateKey: privateKey.replaceAll("\n", "\\n"),
      publicKey: publicKey.replaceAll("\n", "\\n"),
    });
    const bytes = Buffer.from("CRA-REPORTING-PACKAGE-V1", "utf8");

    expect(verify(null, bytes, publicKey, signer.sign(bytes).signature)).toBe(true);
  });
});

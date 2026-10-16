import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { generateKeyPairSync, X509Certificate } from "node:crypto";

import { AgentCertificateAuthority } from "./agent-certificate-authority";

const run = promisify(execFile);
const ids = {
  agentId: "f2cb5e61-9478-49fb-89de-96b653273425",
  organizationId: "ace5f442-6b7f-4c35-b81d-b65930d9c157",
  connectorId: "1450c6ee-2607-4f66-83d5-e19bd5a159ab",
};

describe("agent certificate authority", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cra-agent-ca-test-"));
    const key = () =>
      generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export(
        { type: "pkcs8", format: "pem" },
      );
    await writeFile(join(directory, "ca.key"), key(), { mode: 0o600 });
    await writeFile(join(directory, "agent.key"), key(), { mode: 0o600 });
    await run("openssl", [
      "req",
      "-x509",
      "-new",
      "-key",
      join(directory, "ca.key"),
      "-out",
      join(directory, "ca.pem"),
      "-days",
      "2",
      "-subj",
      "/CN=CRA test agent CA",
    ]);
    await run("openssl", [
      "req",
      "-new",
      "-key",
      join(directory, "agent.key"),
      "-out",
      join(directory, "agent.csr"),
      "-subj",
      "/CN=Agent",
    ]);
    await run("openssl", [
      "req",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      join(directory, "explicit.key"),
      "-out",
      join(directory, "explicit.csr"),
      "-subj",
      "/CN=Explicit",
    ]);
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("issues a client-only certificate bound to all three identities", async () => {
    const ca = new AgentCertificateAuthority(
      join(directory, "ca.pem"),
      join(directory, "ca.key"),
    );
    const issued = await ca.issue(
      ids,
      await readFile(join(directory, "agent.csr"), "utf8"),
    );
    const cert = new X509Certificate(issued.clientCertificatePem);
    expect(cert.subjectAltName).toBe(
      `URI:urn:cra:agent:${ids.agentId}:org:${ids.organizationId}:connector:${ids.connectorId}`,
    );
    expect(issued.fingerprint).toBe(
      cert.fingerprint256.replaceAll(":", "").toLowerCase(),
    );
    expect(issued.caCertificatePem).toContain("BEGIN CERTIFICATE");
  });

  it("rejects malformed CSRs without issuing a certificate", async () => {
    const ca = new AgentCertificateAuthority(
      join(directory, "ca.pem"),
      join(directory, "ca.key"),
    );
    await expect(
      ca.issue(
        ids,
        "-----BEGIN CERTIFICATE REQUEST-----\ninvalid\n-----END CERTIFICATE REQUEST-----",
      ),
    ).rejects.toThrow();
  });
  it("rejects P-256 CSRs with explicit curve parameters that Node TLS cannot use", async () => {
    const ca = new AgentCertificateAuthority(
      join(directory, "ca.pem"),
      join(directory, "ca.key"),
    );
    await expect(
      ca.issue(ids, await readFile(join(directory, "explicit.csr"), "utf8")),
    ).rejects.toThrow();
  });
});

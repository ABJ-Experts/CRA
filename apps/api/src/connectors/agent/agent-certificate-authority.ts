import { execFile } from "node:child_process";
import { createPublicKey, randomBytes, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const csrPattern =
  /^-----BEGIN CERTIFICATE REQUEST-----\r?\n[\s\S]{64,16000}-----END CERTIFICATE REQUEST-----\s*$/;
const MAX_CSR_BYTES = 16_000;
// DER SubjectPublicKeyInfo for an uncompressed P-256 key with named-curve OID.
// Some OpenSSL/LibreSSL key-generation flags emit explicit curve parameters;
// Node TLS rejects those certificates even though OpenSSL calls them P-256.
const NAMED_P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d03010703420004",
  "hex",
);

export type AgentCertIdentity = Readonly<{
  agentId: string;
  organizationId: string;
  connectorId: string;
}>;

export function agentCertificateSan(ids: AgentCertIdentity): string {
  if (
    ![ids.agentId, ids.organizationId, ids.connectorId].every((id) =>
      uuid.test(id),
    )
  )
    throw new Error("Invalid agent certificate identity");
  return `URI:urn:cra:agent:${ids.agentId}:org:${ids.organizationId}:connector:${ids.connectorId}`;
}

export type IssuedAgentCertificate = Readonly<{
  clientCertificatePem: string;
  caCertificatePem: string;
  serial: string;
  fingerprint: string;
  expiresAt: string;
}>;

export class AgentCsrError extends Error {
  constructor() {
    super("Invalid agent CSR");
  }
}

/** Fixed OpenSSL arguments only; CSRs never become shell commands or config paths. */
export class AgentCertificateAuthority {
  constructor(
    private readonly caCertificatePath: string,
    private readonly caPrivateKeyPath: string,
  ) {}

  async issue(
    ids: AgentCertIdentity,
    csrPem: string,
  ): Promise<IssuedAgentCertificate> {
    const san = agentCertificateSan(ids);
    if (Buffer.byteLength(csrPem) > MAX_CSR_BYTES || !csrPattern.test(csrPem))
      throw new AgentCsrError();

    const directory = await mkdtemp(join(tmpdir(), "cra-agent-cert-"));
    const csrPath = join(directory, "agent.csr");
    const certificatePath = join(directory, "agent.pem");
    const extensionsPath = join(directory, "extensions.cnf");
    const serial = randomBytes(16).toString("hex");
    try {
      await writeFile(csrPath, csrPem, { mode: 0o600 });
      await writeFile(
        extensionsPath,
        [
          "basicConstraints=critical,CA:FALSE",
          "keyUsage=critical,digitalSignature",
          "extendedKeyUsage=clientAuth",
          `subjectAltName=${san}`,
          "",
        ].join("\n"),
        { mode: 0o600 },
      );

      const options = { timeout: 10_000, maxBuffer: 64_000 };
      try {
        await exec(
          "openssl",
          ["req", "-in", csrPath, "-verify", "-noout"],
          options,
        );
        const { stdout: publicKeyPem } = await exec(
          "openssl",
          ["req", "-in", csrPath, "-pubkey", "-noout"],
          options,
        );
        const publicKey = createPublicKey(publicKeyPem);
        if (
          publicKey.asymmetricKeyType !== "ec" ||
          publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
        )
          throw new AgentCsrError();
        const spki = publicKey.export({ format: "der", type: "spki" });
        if (
          spki.length !== 91 ||
          !spki
            .subarray(0, NAMED_P256_SPKI_PREFIX.length)
            .equals(NAMED_P256_SPKI_PREFIX)
        )
          throw new AgentCsrError();
      } catch {
        throw new AgentCsrError();
      }

      await exec(
        "openssl",
        [
          "x509",
          "-req",
          "-in",
          csrPath,
          "-CA",
          this.caCertificatePath,
          "-CAkey",
          this.caPrivateKeyPath,
          "-set_serial",
          `0x${serial}`,
          "-days",
          "90",
          "-sha256",
          "-extfile",
          extensionsPath,
          "-out",
          certificatePath,
        ],
        options,
      );
      const [clientCertificatePem, caCertificatePem] = await Promise.all([
        readFile(certificatePath, "utf8"),
        readFile(this.caCertificatePath, "utf8"),
      ]);
      const certificate = new X509Certificate(clientCertificatePem);
      if (
        certificate.subjectAltName !== san ||
        !certificate.verify(new X509Certificate(caCertificatePem).publicKey)
      )
        throw new Error("Issued agent certificate failed verification");
      return Object.freeze({
        clientCertificatePem,
        caCertificatePem,
        serial,
        fingerprint: certificate.fingerprint256
          .replaceAll(":", "")
          .toLowerCase(),
        expiresAt: new Date(certificate.validTo).toISOString(),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function verifiedPeerFingerprint(
  socket: Readonly<{
    authorized?: boolean;
    getPeerCertificate?: (detailed?: boolean) => { raw?: Buffer };
  }>,
  ids: AgentCertIdentity,
): string | null {
  if (socket.authorized !== true || !socket.getPeerCertificate) return null;
  const raw = socket.getPeerCertificate(true).raw;
  if (!raw) return null;
  try {
    const cert = new X509Certificate(raw);
    if (cert.subjectAltName !== agentCertificateSan(ids)) return null;
    const now = Date.now();
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo))
      return null;
    return cert.fingerprint256.replaceAll(":", "").toLowerCase();
  } catch {
    return null;
  }
}

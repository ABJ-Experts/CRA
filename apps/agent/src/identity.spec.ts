import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareCertificateRequest } from "./identity.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("keeps the generated P-256 private key local and creates a PEM CSR", () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-csr-")); roots.push(root);
  const keyPath = join(root, "private.pem");
  const csr = prepareCertificateRequest(keyPath);
  expect(csr).toContain("BEGIN CERTIFICATE REQUEST");
  expect(readFileSync(keyPath, "utf8")).toContain("BEGIN PRIVATE KEY");
  expect(statSync(keyPath).mode & 0o077).toBe(0);
  expect(csr).not.toContain("PRIVATE KEY");
  const publicKey = execFileSync("openssl", ["req", "-pubkey", "-noout"], { input: csr });
  const keyDetails = execFileSync("openssl", ["pkey", "-pubin", "-text", "-noout"], { input: publicKey, encoding: "utf8" });
  expect(keyDetails).toContain("ASN1 OID: prime256v1");
  expect(prepareCertificateRequest(keyPath)).toContain("BEGIN CERTIFICATE REQUEST");
  writeFileSync(keyPath, "invalid private key");
  expect(() => prepareCertificateRequest(keyPath)).toThrow("csr_generation_failed");
});

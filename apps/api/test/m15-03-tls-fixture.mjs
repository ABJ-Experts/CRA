import { execFileSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createCertificates(directory) {
  const run = (...args) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  run(
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=M15-03 Task CA",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
  );
  for (const name of ["server", "client", "ungranted"]) {
    run(
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=M15-03 ${name}`,
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
    );
    await writeFile(
      join(directory, `${name}.ext`),
      name === "server"
        ? "subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n"
        : "extendedKeyUsage=clientAuth\n",
    );
    run(
      "x509",
      "-req",
      "-days",
      "1",
      "-in",
      `${name}.csr`,
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-extfile",
      `${name}.ext`,
      "-out",
      `${name}.crt`,
    );
    await chmod(join(directory, `${name}.key`), 0o600);
  }
  await chmod(join(directory, "ca.key"), 0o600);
  const load = (name) => readFile(join(directory, name));
  return {
    ca: await load("ca.crt"),
    serverCert: await load("server.crt"),
    serverKey: await load("server.key"),
    cert: await load("client.crt"),
    key: await load("client.key"),
    ungrantedCert: await load("ungranted.crt"),
    ungrantedKey: await load("ungranted.key"),
  };
}

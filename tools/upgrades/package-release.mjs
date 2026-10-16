import { createHash, createPrivateKey, sign } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { open, readFile, lstat, mkdir, copyFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
export function signManifest(bytes, privateKey, kid) {
  if (
    privateKey.asymmetricKeyType !== "ed25519" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(kid)
  )
    throw new Error("invalid release signing identity");
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", typ: "CRA-RELEASE+JWS", kid }),
  ).toString("base64url");
  const payload = bytes.toString("base64url");
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString("base64url")}`;
}
export function validateInputNames(names) {
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        !/^(?:[A-Za-z0-9][A-Za-z0-9_-]*\.tar|[0-9]{14}_[a-z0-9_]+\.sql|[A-Za-z0-9][A-Za-z0-9_-]*\.(?:json|txt))$/.test(
          name,
        ),
    )
  )
    throw new Error("unsafe release inventory");
}
async function inspect(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.size === 0)
    throw new Error("release inputs must be nonempty regular files");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest("hex"), bytes: details.size };
}
function tarHeader(name, bytes) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  const octal = (value, start, size) =>
    header.write(
      value.toString(8).padStart(size - 1, "0") + "\0",
      start,
      size,
      "ascii",
    );
  octal(0o600, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(bytes, 124, 12);
  octal(0, 136, 12);
  header.fill(32, 148, 156);
  header[156] = 48;
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return header;
}
/** Only host-reviewed data filenames enter the archive, never bundle code/Compose. */
export async function packageRelease(configPath, keyPath, outputRoot) {
  const { upgradeManifestSchema } =
    await import("../../packages/contracts/dist/upgrades/schemas/index.js");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const keyStat = await lstat(keyPath);
  if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.mode & 0o077)
    throw new Error("signing key must be a private mounted regular file");
  const privateKey = createPrivateKey(await readFile(keyPath));
  const inputs = [
    ...config.images.map((image) => ({
      ...image,
      name: basename(image.path),
      kind: "image",
    })),
    ...config.migrations.map((item) => ({
      ...item,
      name: basename(item.path),
      kind: "migration",
    })),
    { path: config.sbomPath, name: "sbom.json", kind: "sbom" },
  ];
  validateInputNames(inputs.map((item) => item.name));
  await mkdir(outputRoot, { mode: 0o700 });
  const payloadRoot = join(outputRoot, "content");
  await mkdir(payloadRoot, { mode: 0o700 });
  const inventory = [];
  for (const input of inputs) {
    // Copies bind all subsequent digest/signing operations to private snapshots.
    await inspect(input.path);
    const path = join(payloadRoot, input.name);
    await copyFile(input.path, path, constants.COPYFILE_EXCL);
    inventory.push({ ...input, path, ...(await inspect(path)) });
  }
  const sbom = JSON.parse(
    await readFile(join(payloadRoot, "sbom.json"), "utf8"),
  );
  if (
    sbom.bomFormat !== "CycloneDX" ||
    !Array.isArray(sbom.components) ||
    sbom.components.length === 0
  )
    throw new Error("real CycloneDX component inventory required");
  const archive = await open(join(outputRoot, "payload.tar"), "wx", 0o600);
  try {
    for (const item of inventory) {
      await archive.writeFile(tarHeader(item.name, item.bytes));
      for await (const chunk of createReadStream(item.path))
        await archive.writeFile(chunk);
      const padding = (512 - (item.bytes % 512)) % 512;
      if (padding) await archive.writeFile(Buffer.alloc(padding));
    }
    await archive.writeFile(Buffer.alloc(1024));
    await archive.sync();
  } finally {
    await archive.close();
  }
  const manifest = upgradeManifestSchema.parse({
    ...config.manifest,
    archive: {
      name: "payload.tar",
      ...(await inspect(join(outputRoot, "payload.tar"))),
      expandedBytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
      entryCount: inventory.length,
    },
    images: inventory
      .filter((item) => item.kind === "image")
      .map((item) => ({
        service: item.service,
        digest: item.digest,
        archive: { name: item.name, sha256: item.sha256, bytes: item.bytes },
      })),
    migrations: inventory
      .filter((item) => item.kind === "migration")
      .map((item) => ({
        name: item.name,
        sha256: item.sha256,
        transactional: true,
        backwardCompatible: true,
      })),
    artifacts: inventory
      .filter((item) => item.kind === "sbom")
      .map((item) => ({
        name: item.name,
        sha256: item.sha256,
        bytes: item.bytes,
        kind: "sbom",
      })),
  });
  const bytes = Buffer.from(JSON.stringify(manifest));
  const manifestFile = await open(
    join(outputRoot, "manifest.json"),
    "wx",
    0o600,
  );
  try {
    await manifestFile.writeFile(bytes);
    await manifestFile.sync();
  } finally {
    await manifestFile.close();
  }
  const jws = await open(join(outputRoot, "release.jws"), "wx", 0o600);
  try {
    await jws.writeFile(signManifest(bytes, privateKey, config.kid));
    await jws.sync();
  } finally {
    await jws.close();
  }
  return {
    releaseId: manifest.releaseId,
    manifestDigest: createHash("sha256").update(bytes).digest("hex"),
    files: inventory.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [config, key, output, ...extra] = process.argv.slice(2);
  if (!config || !key || !output || extra.length)
    throw new Error(
      "usage: node package-release.mjs config.json /private/signing-key.pem NEW_OUTPUT_DIRECTORY",
    );
  packageRelease(config, key, output)
    .then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch(() => {
      process.stderr.write(
        "Release packaging failed; inspect private inputs and remove incomplete output before retry.\n",
      );
      process.exitCode = 1;
    });
}

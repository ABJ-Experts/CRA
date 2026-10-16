import { createHash } from "node:crypto";
export const sha = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function tar(
  entries: readonly {
    name: string;
    body?: Buffer;
    kind?: string;
    link?: string;
  }[],
): Buffer {
  return Buffer.concat([
    ...entries.flatMap((entry) => {
      const body = entry.body ?? Buffer.alloc(0);
      const header = Buffer.alloc(512);
      header.write(entry.name);
      header.write("0000644\0", 100);
      header.write("0000000\0", 108);
      header.write("0000000\0", 116);
      header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
      header.fill(32, 148, 156);
      header[156] = (entry.kind ?? "0").charCodeAt(0);
      if (entry.link) header.write(entry.link, 157);
      header.write("ustar\0", 257);
      header.write("00", 263);
      const sum = header.reduce((a, b) => a + b, 0);
      header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
      return [header, body, Buffer.alloc((512 - (body.length % 512)) % 512)];
    }),
    Buffer.alloc(1024),
  ]);
}
export function dockerSave(
  options: {
    layer?: Buffer;
    arch?: string;
    extra?: readonly {
      name: string;
      body?: Buffer;
      kind?: string;
      link?: string;
    }[];
    multiple?: boolean;
  } = {},
) {
  const layer =
    options.layer ??
    tar([
      { name: "etc", kind: "5" },
      { name: "etc/example", body: Buffer.from("example") },
    ]);
  const config = Buffer.from(
    JSON.stringify({
      os: "linux",
      architecture: options.arch ?? "amd64",
      rootfs: { type: "layers", diff_ids: [`sha256:${sha(layer)}`] },
    }),
  );
  const configName = `${sha(config)}.json`;
  const manifest = {
    Config: configName,
    RepoTags: [],
    Layers: ["layer/layer.tar"],
  };
  const archive = tar([
    {
      name: "manifest.json",
      body: Buffer.from(
        JSON.stringify(options.multiple ? [manifest, manifest] : [manifest]),
      ),
    },
    { name: configName, body: config },
    { name: "layer", kind: "5" },
    { name: "layer/layer.tar", body: layer },
    ...(options.extra ?? []),
  ]);
  return {
    archive,
    digest: `sha256:${sha(config)}`,
    layer,
    config,
    configName,
  };
}

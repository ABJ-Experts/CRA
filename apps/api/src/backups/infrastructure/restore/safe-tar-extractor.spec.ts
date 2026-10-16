import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractRecoveryTar } from "./safe-tar-extractor";
function tar(name: string, content: Buffer, type = "0") {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("0000600\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return Buffer.concat([
    header,
    content,
    Buffer.alloc((512 - (content.length % 512)) % 512),
    Buffer.alloc(1024),
  ]);
}
describe("authenticated recovery tar extraction", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-tar-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("extracts bounded regular files with generated protected directories", async () => {
    await writeFile(
      join(root, "part"),
      tar("base/PG_VERSION", Buffer.from("17\n")),
    );
    expect(
      await extractRecoveryTar(join(root, "part"), join(root, "output"), {
        maxEntries: 10,
        maxExpandedBytes: 100,
      }),
    ).toEqual({ entries: 1, bytes: 3 });
    expect(await readFile(join(root, "output/base/PG_VERSION"), "utf8")).toBe(
      "17\n",
    );
  });
  it.each(["../outside", "/outside", "base/../outside", "base\\outside"])(
    "rejects unsafe path %s",
    async (name) => {
      await writeFile(join(root, "part"), tar(name, Buffer.from("canary")));
      await expect(
        extractRecoveryTar(join(root, "part"), join(root, "output"), {
          maxEntries: 10,
          maxExpandedBytes: 100,
        }),
      ).rejects.toThrow("recovery_archive_unsafe");
    },
  );
  it("rejects links, devices, extension headers and excessive expansion", async () => {
    for (const type of ["1", "2", "3", "4", "x", "g", "L"]) {
      await writeFile(join(root, "part"), tar("link", Buffer.alloc(0), type));
      await expect(
        extractRecoveryTar(join(root, "part"), join(root, "output"), {
          maxEntries: 10,
          maxExpandedBytes: 100,
        }),
      ).rejects.toThrow("recovery_archive_unsafe");
    }
    await writeFile(join(root, "part"), tar("huge", Buffer.alloc(101)));
    await expect(
      extractRecoveryTar(join(root, "part"), join(root, "output"), {
        maxEntries: 10,
        maxExpandedBytes: 100,
      }),
    ).rejects.toThrow();
  });
  it("rejects bad checksum, truncated content and missing terminator", async () => {
    const valid = tar("file", Buffer.from("abc"));
    for (const part of [
      Buffer.from(valid).fill(255, 0, 1),
      valid.subarray(0, 513),
      valid.subarray(0, 1024),
    ]) {
      await writeFile(join(root, "part"), part);
      await expect(
        extractRecoveryTar(join(root, "part"), join(root, "output"), {
          maxEntries: 10,
          maxExpandedBytes: 100,
        }),
      ).rejects.toThrow();
    }
  });
  it("never overwrites an existing destination or follows an existing file", async () => {
    await writeFile(join(root, "part"), tar("existing", Buffer.from("new")));
    await writeFile(join(root, "existing"), "old");
    await expect(
      extractRecoveryTar(join(root, "part"), root, {
        maxEntries: 10,
        maxExpandedBytes: 100,
      }),
    ).rejects.toThrow();
    expect(await readFile(join(root, "existing"), "utf8")).toBe("old");
  });
  it("honors abort before opening an archive", async () => {
    const signal = AbortSignal.abort();
    await expect(
      extractRecoveryTar(
        "missing",
        root,
        { maxEntries: 10, maxExpandedBytes: 100 },
        signal,
      ),
    ).rejects.toThrow();
  });
});

describe("tar structural edge cases", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-tar-structure-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  async function extract(part: Buffer, limit = 100, entries = 10) {
    await writeFile(join(root, "part"), part);
    return extractRecoveryTar(join(root, "part"), join(root, "out"), {
      maxEntries: entries,
      maxExpandedBytes: limit,
    });
  }
  it("accepts root and empty directory entries, then streams regular file data", async () => {
    const rootHeader = tar("./", Buffer.alloc(0), "5").subarray(0, 512);
    const directory = tar("base/", Buffer.alloc(0), "5").subarray(0, 512);
    expect(
      await extract(
        Buffer.concat([
          rootHeader,
          directory,
          tar("base/empty", Buffer.alloc(0)),
        ]),
      ),
    ).toEqual({ entries: 2, bytes: 0 });
  });
  it("rejects nonempty directories, malformed octal, entry overflow and nonzero trailing bytes", async () => {
    for (const part of [
      tar("dir", Buffer.from("x"), "5"),
      Buffer.concat([tar("file", Buffer.alloc(0)), Buffer.from("x")]),
      tar("file", Buffer.alloc(0)).fill(0x39, 124, 125),
    ])
      await expect(extract(part)).rejects.toThrow();
    await expect(
      extract(tar("file", Buffer.alloc(0)), 100, 0),
    ).rejects.toThrow();
  });
  it("rejects archive overhead beyond its declared expansion budget", async () => {
    await expect(extract(Buffer.alloc(2 * 1024 * 1024), 1, 1)).rejects.toThrow(
      "recovery_archive_unsafe",
    );
  });
  it("rejects nonzero second termination blocks", async () => {
    const part = Buffer.alloc(1024);
    part[600] = 1;
    await expect(extract(part)).rejects.toThrow("recovery_archive_unsafe");
  });
  it("does not accept an empty octal field or a traversal through a preexisting link", async () => {
    const part = tar("file", Buffer.alloc(0));
    part.fill(0, 124, 136);
    part.fill(32, 148, 156);
    part.write(
      part
        .subarray(0, 512)
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    await expect(extract(part)).rejects.toThrow();
  });
});

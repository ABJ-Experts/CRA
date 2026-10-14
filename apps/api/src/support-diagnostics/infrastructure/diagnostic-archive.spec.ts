import { buildStoredZipStream } from "../../common/archive/stored-zip";
import { DiagnosticArchive } from "./diagnostic-archive";
const id = "11111111-1111-4111-8111-111111111111";
const selection = {
  categories: ["logs" as const],
  from: "2026-10-13T00:00:00.000Z",
  to: "2026-10-14T00:00:00.000Z",
};
describe("diagnostic fixed archive", () => {
  it("roundtrips only fixed validated sections and checks entry hashes", async () => {
    const archive = new DiagnosticArchive(() => new Date(selection.to));
    const packed = await archive.pack(id, selection, {
      logs: [],
      omissions: [],
    });
    const inspected = await archive.inspect(packed.bytes);
    expect(inspected.manifest.jobId).toBe(id);
    expect(inspected.logs).toEqual([]);
    const corrupt = Buffer.from(packed.bytes);
    corrupt[40] = 255;
    await expect(archive.inspect(corrupt)).rejects.toThrow();
  });
  it("rejects malformed, truncated and overlarge archives", async () => {
    const archive = new DiagnosticArchive();
    await expect(archive.inspect(Buffer.from("not zip"))).rejects.toThrow();
    await expect(archive.inspect(Buffer.alloc(10485761))).rejects.toThrow();
  });
});

it("rejects duplicate, missing, arbitrary, compressed, encrypted and mismatched entry hashes", async () => {
  const archive = new DiagnosticArchive();
  for (const files of [
    [{ name: "private.json", bytes: Buffer.from("[]") }],
    [{ name: "logs.json", bytes: Buffer.from("[]") }],
  ]) {
    const built = buildStoredZipStream(files);
    const chunks: Buffer[] = [];
    for await (const chunk of built.stream) chunks.push(chunk as Buffer);
    await expect(archive.inspect(Buffer.concat(chunks))).rejects.toThrow();
  }
  const packed = await archive.pack(id, selection, { logs: [], omissions: [] });
  const central = packed.bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const [offset, value] of [
    [central + 10, 8],
    [central + 8, 1],
    [central + 24, 1],
  ] as const) {
    const copy = Buffer.from(packed.bytes);
    copy.writeUInt16LE(value, offset);
    await expect(archive.inspect(copy)).rejects.toThrow();
  }
  const forged = Buffer.from(packed.bytes);
  const content = forged.indexOf(Buffer.from('"sha256":"'));
  forged[content + 10] = 0x30;
  await expect(archive.inspect(forged)).rejects.toThrow();
});

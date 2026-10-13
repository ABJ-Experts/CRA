import { inspectEvidenceMediaType } from "./evidence-media-inspection";
import { fromBuffer } from "file-type";

jest.mock("file-type", () => {
  const original = jest.requireActual<typeof import("file-type")>("file-type");
  return { ...original, fromBuffer: jest.fn(original.fromBuffer) };
});

const word =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const sheet =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const presentation =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function inspect(
  bytes: Buffer,
  readArchiveBytes = jest.fn(() => Promise.resolve(bytes)),
) {
  return inspectEvidenceMediaType(
    bytes.subarray(0, 8192),
    bytes.subarray(0, 8192).toString("utf8"),
    readArchiveBytes,
  );
}

describe("shared evidence media inspection", () => {
  afterEach(() => {
    jest
      .mocked(fromBuffer)
      .mockImplementation(
        jest.requireActual<typeof import("file-type")>("file-type").fromBuffer,
      );
  });

  it.each([
    [Buffer.from("abc"), "text/plain"],
    [Buffer.from("a,b\nc,d"), "text/csv"],
    [Buffer.from("%PDF-document"), "application/pdf"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5+wAAAABJRU5ErkJggg==",
        "base64",
      ),
      "image/png",
    ],
    [Buffer.from("RIFFxxxxWEBPVP8 "), "image/webp"],
  ])(
    "derives %s from content without reading the full file",
    async (bytes, expected) => {
      const read = jest.fn(() => Promise.resolve(bytes));
      await expect(inspect(bytes, read)).resolves.toBe(expected);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    Buffer.from([0, 1, 2]),
    Buffer.from([1, 2, 3]),
    Buffer.from("MZ\0%PDF-document"),
  ])("rejects unsupported or disguised binary probes", async (bytes) => {
    await expect(inspect(bytes)).resolves.toBeNull();
  });

  it.each([
    ["word/document.xml", word],
    ["xl/workbook.xml", sheet],
    ["ppt/presentation.xml", presentation],
  ])(
    "checks OOXML directory metadata for %s",
    async (documentPath, expected) => {
      jest
        .mocked(fromBuffer)
        .mockResolvedValue({ ext: "zip", mime: "application/zip" });
      const bytes = storedZip([
        ["[Content_Types].xml", "types"],
        [documentPath, "document"],
      ]);
      const read = jest.fn(() => Promise.resolve(bytes));
      await expect(inspect(bytes, read)).resolves.toBe(expected);
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [["word/document.xml", "document"]],
    [["[Content_Types].xml", "types"]],
    [
      ["[Content_Types].xml", "types"],
      ["word/document.xml", "document"],
      ["word/vbaProject.bin", "macro"],
    ],
    [
      ["[Content_Types].xml", "types"],
      ["word/document.xml", "document"],
      ["../evil.xml", "traversal"],
    ],
    [
      ["[Content_Types].xml", "types"],
      ["word/document.xml", "document"],
      ["/evil.xml", "absolute"],
    ],
  ] as const)(
    "rejects unsafe or unrecognized OOXML metadata %#",
    async (...entries) => {
      jest
        .mocked(fromBuffer)
        .mockResolvedValue({ ext: "zip", mime: "application/zip" });
      await expect(inspect(storedZip(entries))).resolves.toBeNull();
    },
  );

  it("rejects malformed archives and a full archive beyond 50 MiB", async () => {
    jest
      .mocked(fromBuffer)
      .mockResolvedValue({ ext: "zip", mime: "application/zip" });
    await expect(inspect(Buffer.from("invalid zip"))).resolves.toBeNull();
    const read = jest.fn(() =>
      Promise.resolve(Buffer.alloc(50 * 1024 * 1024 + 1)),
    );
    await expect(inspect(Buffer.from("zip"), read)).resolves.toBeNull();
  });
});

function storedZip(entries: readonly (readonly [string, string])[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [filename, value] of entries) {
    const name = Buffer.from(filename);
    const data = Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

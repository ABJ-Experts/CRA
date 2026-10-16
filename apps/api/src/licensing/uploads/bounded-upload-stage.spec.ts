import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { stageBoundedUpload } from "./bounded-upload-stage";

describe("bounded upload staging", () => {
  it("streams exact bytes, hashes them and cleans only its private staging file", async () => {
    const staged = await stageBoundedUpload(
      Readable.from([Buffer.from("abc")]),
      3,
    );
    expect(staged.byteSize).toBe(3);
    expect(staged.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await readFile(staged.path)).toEqual(Buffer.from("abc"));
    await staged.dispose();
    await expect(readFile(staged.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it.each([
    ["ab", 3],
    ["abcd", 3],
  ])(
    "rejects truncation and overrun before publication",
    async (bytes, expected) => {
      await expect(
        stageBoundedUpload(Readable.from([Buffer.from(bytes)]), expected),
      ).rejects.toThrow("upload_length_mismatch");
    },
  );
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    "rejects invalid reservation sizes",
    async (size) => {
      await expect(stageBoundedUpload(Readable.from([]), size)).rejects.toThrow(
        "invalid_upload_size",
      );
    },
  );
  it("propagates stream interruption without returning publishable data", async () => {
    async function* interrupted() {
      yield await Promise.resolve(Buffer.from("a"));
      throw new Error("interrupted");
    }
    await expect(
      stageBoundedUpload(Readable.from(interrupted()), 3),
    ).rejects.toThrow("interrupted");
  });
});

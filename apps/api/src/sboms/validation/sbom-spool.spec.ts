import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { openSbomSpool, withSbomSpool } from "./sbom-spool";
describe("private bounded SBOM spool", () => {
  afterEach(() => jest.restoreAllMocks());
  it("writes exact bytes with restrictive permissions and removes the directory", async () => {
    let path = "";
    await withSbomSpool(
      Readable.from([Buffer.from("a"), Buffer.from("b")]),
      2,
      async (file) => {
        path = file;
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
        let text = "";
        for await (const chunk of openSbomSpool(file) as AsyncIterable<Buffer>)
          text += chunk.toString();
        expect(text).toBe("ab");
      },
    );
    await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("closes a source when disk setup fails before reading it", async () => {
    jest.spyOn(fs, "mkdtemp").mockRejectedValueOnce(new Error("disk failed"));
    const source = Readable.from([Buffer.from("private")]);
    await expect(withSbomSpool(source, 100, async () => {})).rejects.toThrow(
      "disk failed",
    );
    expect(source.destroyed).toBe(true);
  });
  it("removes its private directory when the file cannot open", async () => {
    jest.spyOn(fs, "open").mockRejectedValueOnce(new Error("open failed"));
    const cleanup = jest.spyOn(fs, "rm");
    await expect(
      withSbomSpool(Readable.from([Buffer.from("x")]), 100, async () => {}),
    ).rejects.toThrow("open failed");
    expect(cleanup).toHaveBeenCalledWith(expect.stringContaining("cra-sbom-"), {
      recursive: true,
      force: true,
    });
  });
  it("rejects byte overflow and retains a source failure without consuming a partial file", async () => {
    const consume = jest.fn();
    await expect(
      withSbomSpool(Readable.from([Buffer.from("abc")]), 2, consume),
    ).rejects.toMatchObject({ code: "normalization_byte_limit_exceeded" });
    const source = Readable.from(
      (async function* () {
        await Promise.resolve();
        yield Buffer.from("a");
        throw new Error("source unavailable");
      })(),
    );
    await expect(withSbomSpool(source, 10, consume)).rejects.toThrow(
      "source unavailable",
    );
    expect(consume).not.toHaveBeenCalled();
  });
  it("heartbeats slow source reads and closes the source when the consumer fails", async () => {
    jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(20_000)
      .mockReturnValue(20_000);
    const heartbeat = jest.fn().mockResolvedValue(undefined);
    await expect(
      withSbomSpool(
        Readable.from([Buffer.from("a")]),
        10,
        async () => {
          await Promise.resolve();
          throw new Error("consumer failed");
        },
        heartbeat,
      ),
    ).rejects.toThrow("consumer failed");
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });
});

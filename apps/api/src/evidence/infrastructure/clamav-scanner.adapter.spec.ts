import { Readable } from "node:stream";
import { ClamAvScannerAdapter } from "./clamav-scanner.adapter";

describe("ClamAvScannerAdapter", () => {
  it("fails closed as pending-compatible when scanner configuration is absent", async () => {
    const scanner = new ClamAvScannerAdapter({
      connectTimeoutMs: 1,
      scanTimeoutMs: 1,
    });
    await expect(
      scanner.scan(Readable.from([Buffer.from("EICAR")])),
    ).resolves.toEqual({ outcome: "unavailable", engine: "clamav" });
  });
});

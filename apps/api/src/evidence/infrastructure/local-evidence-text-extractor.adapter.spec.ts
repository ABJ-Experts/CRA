import { Readable } from "node:stream";
import { LocalEvidenceTextExtractorAdapter } from "./local-evidence-text-extractor.adapter";

const options = {
  ocrLanguage: "eng",
  commandTimeoutMs: 1_000,
  overallTimeoutMs: 2_000,
  maximumPixels: 1_000_000,
};

describe("LocalEvidenceTextExtractorAdapter", () => {
  it("normalizes trusted local text only after draining the verified stream", async () => {
    const result = await new LocalEvidenceTextExtractorAdapter(options).extract(
      {
        source: Readable.from(["  acceptable\u0000 evidence\ntext  "]),
        mediaType: "text/plain",
      },
    );
    expect(result).toEqual({
      outcome: "complete",
      text: "acceptable evidence text",
      quality: "native",
      truncated: false,
    });
  });

  it("reports malformed image bytes without creating an empty index", async () => {
    const result = await new LocalEvidenceTextExtractorAdapter(options).extract(
      {
        source: Readable.from([Buffer.from("not an image")]),
        mediaType: "image/png",
      },
    );
    expect(result).toEqual({
      outcome: "failed",
      failureCode: "malformed",
    });
  });

  it("makes a missing local OCR runtime explicit", async () => {
    const result = await new LocalEvidenceTextExtractorAdapter(options).extract(
      {
        source: Readable.from([
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5+wAAAABJRU5ErkJggg==",
            "base64",
          ),
        ]),
        mediaType: "image/png",
      },
    );
    expect(result).toEqual({
      outcome: "failed",
      failureCode: "extractor_unavailable",
    });
  });
});

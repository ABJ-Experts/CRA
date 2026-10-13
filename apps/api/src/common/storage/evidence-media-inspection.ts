import { fromBuffer as fileTypeFromBuffer } from "file-type";
import yauzl from "yauzl";

export async function inspectEvidenceMediaType(
  probe: Buffer,
  text: string,
  readArchiveBytes: () => Promise<Buffer>,
): Promise<string | null> {
  // PDF must begin at byte zero: allowing a leading executable turns a polyglot
  // into a plausible document. Office files are further constrained by their
  // declared extension at the reservation/DB layer and scanned before access.
  if (probe.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  const detected = await fileTypeFromBuffer(probe);
  if (
    detected?.mime === "image/jpeg" ||
    detected?.mime === "image/png" ||
    detected?.mime === "image/webp"
  )
    return detected.mime;
  if (detected?.mime === "application/zip")
    return inspectOoxml(readArchiveBytes);
  if (probe.includes(0)) return null;
  if (!/^[\t\n\r\x20-\x7e\u0080-\uffff]*$/u.test(text)) return null;
  return /[,;\n\r]/.test(text) ? "text/csv" : "text/plain";
}

/** Inspect OOXML central-directory metadata only. yauzl never extracts an
 * entry here: entries are bounded before any future consumer can process one. */
async function inspectOoxml(
  readArchiveBytes: () => Promise<Buffer>,
): Promise<string | null> {
  const bytes = await readArchiveBytes();
  if (bytes.byteLength > 50 * 1024 * 1024) return null;
  return new Promise((resolve) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) return resolve(null);
        let count = 0;
        let total = 0;
        let contentType: string | null = null;
        let done = false;
        const finish = (value: string | null) => {
          if (!done) {
            done = true;
            archive.close();
            resolve(value);
          }
        };
        archive.on("error", () => finish(null));
        let word = false;
        let xl = false;
        let ppt = false;
        archive.on("entry", (entry: yauzl.Entry) => {
          if (
            ++count > 10_000 ||
            entry.uncompressedSize > 50 * 1024 * 1024 ||
            (entry.compressedSize > 0 &&
              entry.uncompressedSize / entry.compressedSize > 100) ||
            entry.fileName.startsWith("/") ||
            entry.fileName.includes("..") ||
            /vbaProject\.bin$/i.test(entry.fileName) ||
            (entry.generalPurposeBitFlag & 1) !== 0
          )
            return finish(null);
          total += entry.uncompressedSize;
          if (total > 200 * 1024 * 1024) return finish(null);
          if (entry.fileName === "[Content_Types].xml") contentType = "pending";
          if (entry.fileName === "word/document.xml") word = true;
          if (entry.fileName === "xl/workbook.xml") xl = true;
          if (entry.fileName === "ppt/presentation.xml") ppt = true;
          archive.readEntry();
        });
        archive.removeAllListeners("end");
        archive.on("end", () =>
          finish(
            contentType === "pending" && word
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : contentType === "pending" && xl
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : contentType === "pending" && ppt
                  ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  : null,
          ),
        );
        archive.readEntry();
      },
    );
  });
}

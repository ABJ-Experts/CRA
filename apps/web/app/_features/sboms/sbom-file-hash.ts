import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export const SBOM_HASH_CHUNK_BYTES = 1024 * 1024;

function readSlice(slice: Blob): Promise<ArrayBuffer> {
  if (typeof slice.arrayBuffer === "function") return slice.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("File read failed"));
    };
    reader.readAsArrayBuffer(slice);
  });
}

/** Hash byte-exact originals while keeping only one bounded slice in memory. */
export async function hashSbomFile(file: Blob): Promise<string> {
  const hash = sha256.create();
  try {
    for (let start = 0; start < file.size; start += SBOM_HASH_CHUNK_BYTES) {
      const end = Math.min(start + SBOM_HASH_CHUNK_BYTES, file.size);
      hash.update(new Uint8Array(await readSlice(file.slice(start, end))));
    }
    return bytesToHex(hash.digest());
  } finally {
    hash.destroy();
  }
}

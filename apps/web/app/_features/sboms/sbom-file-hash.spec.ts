import { describe, expect, it, vi } from "vitest";
import { hashSbomFile, SBOM_HASH_CHUNK_BYTES } from "./sbom-file-hash";

describe("bounded SBOM hashing", () => {
  it("hashes exact bytes without reading the complete file", async () => {
    const bytes = new TextEncoder().encode("abc");
    const file = new Blob([bytes]);
    Object.defineProperty(file, "arrayBuffer", {
      value: () => {
        throw new Error("whole file read");
      },
    });
    expect(await hashSbomFile(file)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("bounds every slice and includes the final partial chunk", async () => {
    const file = new Blob([new Uint8Array(SBOM_HASH_CHUNK_BYTES + 3)]);
    const slices: number[] = [];
    const originalSlice = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      value: (start: number, end: number) => {
        slices.push(end - start);
        return originalSlice(start, end);
      },
    });
    const digest = await hashSbomFile(file);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(slices).toEqual([SBOM_HASH_CHUNK_BYTES, 3]);
  });
  it("propagates failed reads without returning a partial hash", async () => {
    const file = {
      size: 1,
      slice: () => ({
        arrayBuffer: async () => {
          throw new Error("disk failed");
        },
      }),
    } as unknown as Blob;
    await expect(hashSbomFile(file)).rejects.toThrow("disk failed");
  });
  it.each(["success", "error", "invalid"] as const)(
    "handles FileReader fallback %s without full-file reads",
    async (mode) => {
      class Reader {
        result: ArrayBuffer | string =
          mode === "invalid"
            ? "invalid"
            : new TextEncoder().encode("abc").buffer;
        error = new Error("read failed");
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsArrayBuffer() {
          if (mode === "error") this.onerror?.();
          else this.onload?.();
        }
      }
      vi.stubGlobal("FileReader", Reader);
      const file = { size: 3, slice: () => ({}) } as unknown as Blob;
      try {
        if (mode === "success")
          expect(await hashSbomFile(file)).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          );
        else await expect(hashSbomFile(file)).rejects.toThrow(/read failed/i);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedFile, readBoundedJson } from "./operator-read-bounds";
it("rejects an oversized mounted file before admitting its bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-bound-"));
  try {
    const path = join(directory, "grant");
    await writeFile(path, "x".repeat(1024 * 1024 + 1));
    await expect(readBoundedFile(path, 1024 * 1024)).rejects.toThrow(
      "Operator mount exceeds bound",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("cancels chunked oversized JSON even without a Content-Length header", async () => {
  let cancelled = false;
  let chunk = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunk === 0)
        controller.enqueue(new TextEncoder().encode('{"label":"'));
      else if (chunk === 1)
        controller.enqueue(new TextEncoder().encode("x".repeat(256 * 1024)));
      else {
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      }
      chunk++;
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readBoundedJson(new Response(stream), 256 * 1024),
  ).rejects.toThrow("Operator response exceeds bound");
  expect(cancelled).toBe(true);
});
it("denies non-file mounts and empty or declared oversized bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-bounds-types-"));
  try {
    await expect(readBoundedFile(directory, 1024)).rejects.toThrow(
      "Operator mount exceeds bound",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  await expect(readBoundedJson(new Response(null), 1024)).rejects.toThrow(
    "Operator response is empty",
  );
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    readBoundedJson(
      new Response(body, { headers: { "content-length": "2048" } }),
      1024,
    ),
  ).rejects.toThrow("Operator response exceeds bound");
  expect(cancelled).toBe(true);
});

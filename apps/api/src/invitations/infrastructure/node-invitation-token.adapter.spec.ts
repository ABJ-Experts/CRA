import { createHash } from "node:crypto";

import { NodeInvitationTokenAdapter } from "./node-invitation-token.adapter";

describe("NodeInvitationTokenAdapter", () => {
  const adapter = new NodeInvitationTokenAdapter();

  it("creates a high-entropy raw token and its distinct SHA-256 hash", () => {
    const first = adapter.create();
    const second = adapter.create();

    expect(first.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(
      createHash("sha256").update(first.raw).digest("hex"),
    );
    expect(first.raw).not.toBe(first.hash);
    expect(second.raw).not.toBe(first.raw);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("hashes existing raw tokens without retaining them", () => {
    expect(adapter.hash("raw-token")).toBe(
      "34d328009b123fbbb0dc93f18b3e6de1ecf7b1a5783c33dff7ffe1926f09e943",
    );
  });
});

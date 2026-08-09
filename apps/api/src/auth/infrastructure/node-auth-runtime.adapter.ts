import { createHash } from "node:crypto";

import type { DelayPort, SecretHashPort } from "../application/auth-use-cases";

export class NodeSecretHashAdapter implements SecretHashPort {
  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}

export class SystemDelayAdapter implements DelayPort {
  async wait(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

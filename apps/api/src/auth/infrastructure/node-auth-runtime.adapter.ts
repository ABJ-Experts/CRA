import { createHash, randomBytes, randomInt } from "node:crypto";

import type {
  AuthRandomPort,
  ClockPort,
  DelayPort,
  SecretHashPort,
} from "../application/auth-use-cases";

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

export class NodeAuthRandomAdapter implements AuthRandomPort {
  otp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
  }
  token(): string {
    return randomBytes(32).toString("hex");
  }
  recoveryCode(): string {
    return randomBytes(4).toString("hex");
  }
}

export class SystemClockAdapter implements ClockPort {
  now(): Date {
    return new Date();
  }
}

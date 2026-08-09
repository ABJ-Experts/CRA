import { createHash, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { InvitationTokenPort } from "../application/invitation-token.port";

@Injectable()
export class NodeInvitationTokenAdapter implements InvitationTokenPort {
  create(): Readonly<{ raw: string; hash: string }> {
    const raw = randomBytes(32).toString("hex");
    return Object.freeze({ raw, hash: this.hash(raw) });
  }

  hash(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
}

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import { readBoundedJson } from "../../operator/operator-read-bounds";
import type {
  BackupControlAction,
  BackupControlPort,
} from "../application/backup-control.port";
/** This credential may execute one lifecycle RPC only; it cannot read tables or capture data. */
export class NarrowBackupControlClient implements BackupControlPort {
  private readonly endpoint: string;
  constructor(
    url: string,
    private readonly credential: string,
    private readonly projectApiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const target = new URL(url);
    if (
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      (target.protocol !== "https:" &&
        !(
          target.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
        ))
    )
      throw new Error("Invalid backup control endpoint");
    const role = (token: string) =>
      JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as unknown;
    z.object({ role: z.literal("cra_backup_control") })
      .passthrough()
      .parse(role(credential));
    if (!projectApiKey.startsWith("sb_publishable_"))
      z.object({ role: z.literal("anon") })
        .passthrough()
        .parse(role(projectApiKey));
    this.endpoint = `${target.origin}/rest/v1/rpc/m15_05_backup_control`;
  }
  async execute(
    instanceId: string,
    actor: string,
    action: BackupControlAction,
    input: Readonly<Record<string, unknown>> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    let raw: unknown;
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal: signal
          ? AbortSignal.any([
              signal,
              AbortSignal.timeout(action === "run/cancel" ? 40000 : 5000),
            ])
          : AbortSignal.timeout(action === "run/cancel" ? 40000 : 5000),
        headers: {
          apikey: this.projectApiKey,
          Authorization: `Bearer ${this.credential}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_instance_id: instanceId,
          p_actor: actor,
          p_action: action,
          p_input: input,
        }),
      });
      if (!response.ok) throw new Error();
      raw = await readBoundedJson(response, 1024 * 1024);
    } catch {
      throw new ServiceUnavailableException("Backup control unavailable");
    }
    const parsed = z
      .object({
        outcome: z.enum([
          "ok",
          "conflict",
          "not_found",
          "empty",
          "blocked",
          "invalid",
        ]),
        result: z.unknown().optional(),
        execution: z.unknown().optional(),
      })
      .safeParse(raw);
    if (!parsed.success)
      throw new ServiceUnavailableException("Backup control unavailable");
    switch (parsed.data.outcome) {
      case "ok":
        return action === "run/claim"
          ? { run: parsed.data.result, execution: parsed.data.execution }
          : parsed.data.result;
      case "empty":
        return null;
      case "not_found":
        throw new NotFoundException("Backup scope unavailable");
      case "conflict":
        throw new ConflictException("Backup changed; reload and review");
      case "blocked":
        throw new ConflictException(
          "Backup operation blocked by current protection authority",
        );
      case "invalid":
        throw new BadRequestException("Invalid backup request");
    }
  }
}

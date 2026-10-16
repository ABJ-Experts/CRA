import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service";
import type { BackupAssurancePort } from "../application/backup-assurance.port";
@Injectable()
export class SupabaseBackupAssuranceAdapter implements BackupAssurancePort {
  constructor(private readonly supabase: SupabaseService) {}
  async read(
    orgId: string,
    actorId: string,
    limit: number,
    cursor?: string,
    kind?: "capture" | "verification",
  ): Promise<unknown> {
    const result = await this.supabase.admin().rpc("m15_05_backup_assurance", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_limit: limit,
      ...(cursor ? { p_cursor: cursor } : {}),
      ...(kind ? { p_kind: kind } : {}),
    });
    if (result.error)
      throw new ServiceUnavailableException("Backup assurance unavailable");
    return result.data;
  }
}

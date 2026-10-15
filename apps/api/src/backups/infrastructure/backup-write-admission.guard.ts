import {
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
const admission = z.strictObject({
  configured: z.boolean(),
  paused: z.boolean(),
  until: z.iso.datetime({ offset: true }).nullable(),
});
/** Read admission pauses requests early; the native SQL fence closes races and direct Auth/Storage writers. */
@Injectable()
export class BackupWriteAdmissionGuard implements CanActivate {
  private cached?: { observedAt: number; value: z.output<typeof admission> };
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ method: string }>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    const instance = this.config.get<string>("LICENSING_INSTANCE_ID");
    if (!instance) return true;
    const now = Date.now();
    let value: z.output<typeof admission>;
    if (
      this.cached &&
      now - this.cached.observedAt >= 0 &&
      now - this.cached.observedAt < 100
    )
      value = this.cached.value;
    else {
      try {
        z.uuid().parse(instance);
        const result = await this.supabase
          .admin()
          .rpc("m15_05_backup_write_admission", { p_instance_id: instance })
          .abortSignal(AbortSignal.timeout(350));
        if (result.error) throw new Error();
        value = admission.parse(result.data);
        this.cached = { observedAt: now, value };
      } catch {
        throw new ServiceUnavailableException({
          code: "backup_admission_unavailable",
          message: "Backup write admission unavailable",
        });
      }
    }
    const decisionTime = Date.now();
    if (
      value.paused &&
      (!value.until || Date.parse(value.until) > decisionTime)
    ) {
      const seconds = value.until
        ? Math.max(
            1,
            Math.min(
              120,
              Math.ceil((Date.parse(value.until) - decisionTime) / 1000),
            ),
          )
        : 1;
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader("Retry-After", String(seconds));
      throw new ServiceUnavailableException({
        code: "backup_write_pause",
        message: "Writes are temporarily paused for a certified backup",
      });
    }
    return true;
  }
}

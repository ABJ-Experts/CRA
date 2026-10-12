import { Readable } from "node:stream";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseExportWorkerStorage } from "./export-worker-storage.adapter";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { ExportDownload } from "../application/exports.port";
export const privateExportArtifactSchema = z.object({
  id: z.uuid(),
  name: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .max(180),
  mediaType: z.enum([
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/pdf",
    "application/json",
  ]),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  objectPath: z
    .string()
    .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-zA-Z0-9_.-]+$/),
});
export class ExportDeliveryAdapter {
  constructor(private readonly supabase: SupabaseService) {}
  async open(
    orgId: string,
    jobId: string,
    artifact: z.output<typeof privateExportArtifactSchema>,
    authorize: () => Promise<unknown>,
  ): Promise<ExportDownload> {
    if (!artifact.objectPath.startsWith(`${orgId}/${jobId}/`))
      throw new ExportAccessDeniedError();
    let opened: Awaited<
      ReturnType<SupabaseExportWorkerStorage["openVerified"]>
    > = null;
    try {
      opened = await new SupabaseExportWorkerStorage(
        this.supabase,
      ).openVerified(artifact);
      if (!opened) throw new ExportUnavailableError();
      await authorize();
      const input = opened.body;
      const body = Readable.from(
        (async function* () {
          let nextCheck = 0;
          try {
            for await (const chunk of input) {
              if (Date.now() >= nextCheck) {
                await authorize();
                nextCheck = Date.now() + 1000;
              }
              yield chunk;
            }
          } finally {
            input.destroy();
          }
        })(),
      );
      return Object.freeze({
        body,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        mediaType: artifact.mediaType,
        name: artifact.name,
        cleanup: opened.cleanup,
      });
    } catch (error) {
      if (opened) {
        opened.body.destroy();
        await opened.cleanup();
      }
      if (
        error instanceof ExportAccessDeniedError ||
        error instanceof ExportUnavailableError
      )
        throw error;
      throw new ExportUnavailableError();
    }
  }
}

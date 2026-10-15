export interface BackupAssurancePort {
  read(
    organizationId: string,
    actorId: string,
    limit: number,
    cursor?: string,
    kind?: "capture" | "verification",
  ): Promise<unknown>;
}

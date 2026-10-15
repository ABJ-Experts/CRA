import { SupabaseBackupAssuranceAdapter } from "./supabase-backup-assurance.adapter";
it("passes verified org first into the scoped RPC and never returns raw errors", async () => {
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { outcome: "ok" }, error: null });
  const adapter = new SupabaseBackupAssuranceAdapter({
    admin: () => ({ rpc }),
  } as never);
  await expect(adapter.read("org", "actor", 25)).resolves.toEqual({
    outcome: "ok",
  });
  expect(rpc).toHaveBeenCalledWith("m15_05_backup_assurance", {
    p_organization_id: "org",
    p_actor_user_id: "actor",
    p_limit: 25,
  });
  rpc.mockResolvedValueOnce({ error: { secret: "canary" } });
  await expect(adapter.read("org", "actor", 25)).rejects.toThrow(
    "Backup assurance unavailable",
  );
});
it("passes bounded cursor and kind filters to source-owned pagination", async () => {
  const rpc = jest.fn().mockResolvedValue({ data: {}, error: null });
  await new SupabaseBackupAssuranceAdapter({
    admin: () => ({ rpc }),
  } as never).read("org", "actor", 2, "cursor", "verification");
  expect(rpc).toHaveBeenCalledWith("m15_05_backup_assurance", {
    p_organization_id: "org",
    p_actor_user_id: "actor",
    p_limit: 2,
    p_cursor: "cursor",
    p_kind: "verification",
  });
});

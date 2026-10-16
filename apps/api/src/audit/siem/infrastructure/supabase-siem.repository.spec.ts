import { SupabaseSiemRepository } from "./supabase-siem.repository";
import {
  SiemConflictError,
  SiemNotFoundError,
  SiemInputError,
  SiemUnavailableError,
} from "../siem.errors";
describe("SIEM Supabase boundary", () => {
  const rpc = jest.fn();
  const repository = new SupabaseSiemRepository({
    admin: () => ({ rpc }),
  } as never);
  beforeEach(() => rpc.mockReset());
  it("scopes every command and parses provider success", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(
      repository.command("org", "actor", "denial", null, {
        requestId: "request",
      }),
    ).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "m13_05_siem_command",
      expect.objectContaining({
        p_organization_id: "org",
        p_actor_user_id: "actor",
      }),
    );
  });
  it("rejects malformed successful provider results", async () => {
    rpc.mockResolvedValue({ data: { secret: "canary" }, error: null });
    await expect(
      repository.command("org", "actor", "list", null, {}),
    ).rejects.toThrow(SiemUnavailableError);
  });
  it.each([
    ["23505", SiemConflictError],
    ["40001", SiemConflictError],
    ["54000", SiemConflictError],
    ["42501", SiemNotFoundError],
    ["P0002", SiemNotFoundError],
    ["22023", SiemInputError],
    ["OTHER", SiemUnavailableError],
  ])("sanitizes SQL error %s", async (code, constructor) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "secret" } });
    await expect(
      repository.command("org", "actor", "list", null, {}),
    ).rejects.toThrow(constructor);
  });
  it("sanitizes transport errors", async () => {
    rpc.mockRejectedValue(new Error("secret"));
    await expect(
      repository.command("org", "actor", "list", null, {}),
    ).rejects.toThrow(SiemUnavailableError);
  });
  it("parses empty claim and stage result", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { staged: 0 }, error: null });
    await expect(repository.claim("worker")).resolves.toBeNull();
    await repository.stage("worker");
  });
  it("fences authorize and completion with org lease and version", async () => {
    const claim = {
      organizationId: "org",
      deliveryId: "delivery",
      leaseToken: "lease",
      version: 4,
      workerId: "worker",
    } as never;
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(repository.authorize(claim)).resolves.toBeNull();
    await repository.complete(claim, {
      state: "failed",
      code: "safe",
      status: null,
      durationMs: 0,
      retryAfterSeconds: null,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "m13_05_siem_complete",
      expect.objectContaining({
        p_organization_id: "org",
        p_delivery_id: "delivery",
        p_lease_token: "lease",
        p_version: 4,
      }),
    );
  });
});

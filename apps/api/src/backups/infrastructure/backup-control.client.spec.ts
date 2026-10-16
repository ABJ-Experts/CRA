import { BadRequestException } from "@nestjs/common";
import { NarrowBackupControlClient } from "./backup-control.client";
const jwt = (role: string) =>
  `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
describe("narrow backup control credential", () => {
  it("rejects registry or service credentials", () => {
    for (const role of ["service_role", "cra_operator_registry_reader", "anon"])
      expect(
        () =>
          new NarrowBackupControlClient(
            "http://127.0.0.1:54321",
            jwt(role),
            jwt("anon"),
          ),
      ).toThrow();
  });
  it("has only the fixed RPC and bounds safe failures", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ outcome: "ok", result: { safe: true } })),
      );
    const client = new NarrowBackupControlClient(
      "http://127.0.0.1:54321",
      jwt("cra_backup_control"),
      jwt("anon"),
      fetcher,
    );
    await expect(
      client.execute("instance", "operator", "policy/read"),
    ).resolves.toEqual({ safe: true });
    expect(
      (fetcher.mock.calls as unknown as [string, RequestInit][])[0]![0],
    ).toBe("http://127.0.0.1:54321/rest/v1/rpc/m15_05_backup_control");
    expect(
      JSON.parse(
        (fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1]
          .body as string,
      ),
    ).toMatchObject({
      p_instance_id: "instance",
      p_action: "policy/read",
      p_actor: "operator",
    });
    for (const outcome of ["conflict", "not_found", "blocked", "other"]) {
      fetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ outcome, result: "credential canary" })),
      );
      await expect(client.execute("i", "a", "policy/read")).rejects.not.toThrow(
        "credential canary",
      );
    }
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ outcome: "empty" })),
    );
    await expect(client.execute("i", "a", "run/claim")).resolves.toBeNull();
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ outcome: "invalid" })),
    );
    await expect(client.execute("i", "a", "policy/update")).rejects.toThrow(
      BadRequestException,
    );
    fetcher.mockResolvedValueOnce(
      new Response("unsafe exception", { status: 500 }),
    );
    await expect(client.execute("i", "a", "policy/read")).rejects.toThrow(
      "Backup control unavailable",
    );
  });
  it("rejects credential-bearing endpoints and malformed keys", () => {
    for (const url of [
      "http://evil.test",
      "https://a:b@internal.test",
      "https://internal.test?q=x",
    ])
      expect(
        () =>
          new NarrowBackupControlClient(
            url,
            jwt("cra_backup_control"),
            jwt("anon"),
          ),
      ).toThrow();
    expect(
      () =>
        new NarrowBackupControlClient(
          "http://localhost:54321",
          jwt("cra_backup_control"),
          jwt("service_role"),
        ),
    ).toThrow();
  });
});
it("lets atomic cancellation drain a fenced audit while keeping ordinary metadata timeouts short", async () => {
  const timeout = jest.spyOn(AbortSignal, "timeout");
  try {
    const fetcher = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ outcome: "ok", result: {} })),
        ),
      );
    const client = new NarrowBackupControlClient(
      "http://127.0.0.1:54321",
      jwt("cra_backup_control"),
      jwt("anon"),
      fetcher,
    );
    await client.execute("instance", "actor", "run/cancel", {});
    expect(timeout).toHaveBeenLastCalledWith(40000);
    await client.execute("instance", "actor", "run/read", {});
    expect(timeout).toHaveBeenLastCalledWith(5000);
  } finally {
    timeout.mockRestore();
  }
});

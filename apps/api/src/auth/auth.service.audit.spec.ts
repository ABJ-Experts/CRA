import { AuthService } from "./auth.service";

const ID = "b4335932-2d51-4225-9137-3f46de64f00e";
const success = (value: unknown) => ({
  execute: jest.fn().mockResolvedValue({ ok: true, value }),
});

describe("AuthService audit orchestration", () => {
  const create = (audit: object, signOut = success(undefined)) =>
    new AuthService(
      ...([
        success({
          tokens: { accessToken: "a", refreshToken: "r" },
          userId: ID,
        }),
        success({
          tokens: { accessToken: "a", refreshToken: "r" },
          userId: ID,
          emailVerified: true,
        }),
        success({ accessToken: "a", refreshToken: "r" }),
        signOut,
        success(undefined),
        success(undefined),
        success(undefined),
        success(undefined),
        success(undefined),
        success(true),
        audit,
      ] as unknown as ConstructorParameters<typeof AuthService>),
    );

  it("does not invoke global sign-out until a durable intent exists", async () => {
    const signOut = success(undefined);
    const audit = {
      beginCritical: jest.fn().mockRejectedValue(new Error("unavailable")),
      finishCritical: jest.fn(),
      recordBestEffort: jest.fn(),
    };
    await expect(
      create(audit, signOut).signOutEverywhere(ID, "secret-token"),
    ).rejects.toMatchObject({ status: 503 });
    expect(signOut.execute).not.toHaveBeenCalled();
  });

  it("keeps sign-in available when an audit event cannot be saved", async () => {
    const audit = {
      beginCritical: jest.fn(),
      finishCritical: jest.fn(),
      recordBestEffort: jest.fn().mockResolvedValue(false),
    };
    await expect(
      create(audit).signIn({
        email: "u@cra.test",
        password: "secret",
        remember: false,
      }),
    ).resolves.toMatchObject({ userId: ID });
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      "auth.sign_in",
      "completed",
      ID,
      undefined,
    );
    expect(JSON.stringify(audit.recordBestEffort.mock.calls)).not.toContain(
      "secret",
    );
  });

  it("reports an uncertain outcome after provider acceptance without replaying it", async () => {
    const signOut = success(undefined);
    const audit = {
      beginCritical: jest.fn().mockResolvedValue({ operationId: "op" }),
      finishCritical: jest.fn().mockRejectedValue(new Error("audit outage")),
      recordBestEffort: jest.fn(),
    };
    await expect(
      create(audit, signOut).signOutEverywhere(ID, "secret-token"),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "audit_outcome_uncertain" },
    });
    expect(signOut.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.finishCritical.mock.calls)).not.toContain(
      "secret-token",
    );
  });
});

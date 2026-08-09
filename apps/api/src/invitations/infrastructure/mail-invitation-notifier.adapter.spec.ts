import { MailInvitationNotifierAdapter } from "./mail-invitation-notifier.adapter";

describe("MailInvitationNotifierAdapter", () => {
  it("forwards the invitation without changing token or identity fields", async () => {
    const sendInvitation = jest
      .fn<Promise<void>, unknown[]>()
      .mockResolvedValue();
    const adapter = new MailInvitationNotifierAdapter({
      sendInvitation,
    } as never);

    await expect(
      adapter.send("member@cra.test", "raw-token", "CRA", "owner@cra.test"),
    ).resolves.toBeUndefined();
    expect(sendInvitation).toHaveBeenCalledWith(
      "member@cra.test",
      "raw-token",
      "CRA",
      "owner@cra.test",
    );
  });

  it("propagates provider failure to the application boundary", async () => {
    const providerError = new Error("SMTP credentials rejected");
    const sendInvitation = jest
      .fn<Promise<void>, unknown[]>()
      .mockRejectedValue(providerError);
    const adapter = new MailInvitationNotifierAdapter({
      sendInvitation,
    } as never);

    await expect(
      adapter.send("member@cra.test", "raw-token", "CRA", null),
    ).rejects.toBe(providerError);
  });
});
